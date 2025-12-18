import mongoose, { Connection } from 'mongoose';
import {dbConfig} from '../config/db.config';
import {secureLogger} from './logger';

type Operation<T> = (conn: mongoose.Connection) => Promise<T>;

export class MongoDBManager {
    private static instance: MongoDBManager;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    public isConnected = false;

    // 修改构造函数为私有
    private constructor() {
    }

    public static getInstance() {
        if (!MongoDBManager.instance) {
            MongoDBManager.instance = new MongoDBManager();
        }
        return MongoDBManager.instance;
    }

    private readonly config: mongoose.ConnectOptions = {
        maxPoolSize: dbConfig.options.maxPoolSize || 20,
        minPoolSize: dbConfig.options.minPoolSize || 5,
        serverSelectionTimeoutMS: dbConfig.options.serverSelectionTimeoutMS || 15000,
        socketTimeoutMS: dbConfig.options.socketTimeoutMS || 60000,
        retryReads: true,
        retryWrites: true,
        heartbeatFrequencyMS: 10000,
        connectTimeoutMS: dbConfig.options.connectTimeoutMS || 30000,
        family: 4, // 优先使用IPv4
    };

    async ensureConnection(): Promise<boolean> {
        // 如果配置了使用内存缓存，直接返回false表示不使用数据库
        if (dbConfig.useMemoryCache) {
            secureLogger.info('📊 使用内存缓存模式，跳过数据库连接检查');
            return false;
        }
        
        if (this.isConnected && mongoose.connection.readyState === 1) return true;
        try {
            await this.connect();
            return true;
        } catch (error) {
            secureLogger.warn('⚠️ MongoDB connection not available, will use memory cache only');
            return false;
        }
    }

    public async connect(): Promise<void> {
        // 如果配置了使用内存缓存，直接返回
        if (dbConfig.useMemoryCache) {
            secureLogger.info('📊 使用内存缓存模式，跳过数据库连接');
            this.isConnected = false;
            return;
        }
        
        try {
            // 防止重复连接
            if (mongoose.connection.readyState === 1) {
                this.isConnected = true;
                return;
            }
            
            // 检查连接字符串是否存在
            if (!dbConfig.mongoURI) {
                secureLogger.warn('⚠️ MongoDB URI not configured, skipping connection');
                this.isConnected = false;
                return;
            }
            
            // 尝试连接数据库，设置超时时间
            const connectionTimeout = setTimeout(() => {
                secureLogger.warn('⏱️ MongoDB connection timeout reached, will continue with memory cache');
                // 不抛出错误，允许应用继续运行
            }, this.config.serverSelectionTimeoutMS || 15000);
            
            await mongoose.connect(dbConfig.mongoURI, this.config);
            clearTimeout(connectionTimeout);
            
            this.registerEventListeners();
            this.isConnected = true;
            secureLogger.info(`✅ MongoDB Connected: ${mongoose.connection.host}`);
        } catch (error: any) {
            this.handleConnectionError(error);
            this.isConnected = false;
            // 不再抛出错误，允许应用继续运行
            secureLogger.warn('⚠️ MongoDB connection failed, application will continue with memory cache only');
        }
    }

    public async disconnect(): Promise<void> {
        try {
            // 只有在连接状态时才断开
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
                this.isConnected = false;
                secureLogger.info('✅ MongoDB disconnected');
            }
        } catch (error) {
            secureLogger.error('❌ MongoDB disconnection failed:', error);
        }
    }

    private registerEventListeners() {
        // 避免重复注册监听器
        mongoose.connection.removeAllListeners();
        
        mongoose.connection.on('connected', () => {
            this.isConnected = true;
            secureLogger.info('✅ MongoDB connection established');
        });

        mongoose.connection.on('disconnected', () => {
            this.isConnected = false;
            secureLogger.warn('🔄 MongoDB disconnected');
            this.handleDisconnection();
        });

        mongoose.connection.on('reconnected', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            secureLogger.info('✅ MongoDB connection restored');
        });
        
        mongoose.connection.on('error', (error) => {
            secureLogger.error('❌ MongoDB connection error:', error);
        });
        
        mongoose.connection.on('close', () => {
            this.isConnected = false;
            secureLogger.info('🔄 MongoDB connection closed');
        });
    }

    private handleDisconnection() {
        if (!this.isConnected) {
            secureLogger.info('🔄 Attempting to reconnect to MongoDB...');
            // 使用指数退避策略进行重连
            setTimeout(() => {
                this.connect().catch(err => {
                    secureLogger.warn(`⚠️ Reconnection attempt failed: ${err.message}`);
                    this.handleDisconnection(); // 递归调用继续尝试重连
                });
            }, 1000);
        }
    }

    private handleConnectionError(error: Error) {
        secureLogger.error(`❌ MongoDB connection error: ${error.message}`);
        // 不再自动尝试重新连接，减少不必要的网络请求
        this.isConnected = false;
    }

    async executeOperation<T>(operation: Operation<T>, fallback?: () => Promise<T>): Promise<T> {
        try {
            const isConnected = await this.ensureConnection();
            if (isConnected) {
                return await operation(mongoose.connection);
            } else if (fallback) {
                secureLogger.warn('⚠️ MongoDB not available, using fallback operation');
                return await fallback();
            } else {
                throw new Error('MongoDB not available and no fallback provided');
            }
        } catch (error) {
            secureLogger.error('❌ Database operation failed:', error);
            if (fallback) {
                secureLogger.warn('⚠️ Using fallback operation after database error');
                return await fallback();
            }
            throw error;
        }
    }

    async transactionalOperation<T>(operation: Operation<T>, fallback?: () => Promise<T>): Promise<T> {
        try {
            const isConnected = await this.ensureConnection();
            if (isConnected) {
                return await this.executeOperation(async (conn) => {
                    const session = await conn.startSession();
                    session.startTransaction();
                    try {
                        const result = await operation(conn);
                        await session.commitTransaction();
                        return result;
                    } catch (error) {
                        await session.abortTransaction();
                        secureLogger.error('❌ Transaction aborted:', error);
                        throw error;
                    } finally {
                        session.endSession();
                    }
                });
            } else if (fallback) {
                secureLogger.warn('⚠️ MongoDB not available, using fallback operation instead of transaction');
                return await fallback();
            } else {
                throw new Error('MongoDB not available and no fallback provided for transaction');
            }
        } catch (error) {
            secureLogger.error('❌ Transactional operation failed:', error);
            if (fallback) {
                secureLogger.warn('⚠️ Using fallback operation after transaction error');
                return await fallback();
            }
            throw error;
        }
    }
    
    // 检查数据库连接状态
    getConnectionStatus(): {
        isConnected: boolean;
        readyState: number;
        connectionString: string;
    } {
        return {
            isConnected: this.isConnected,
            readyState: mongoose.connection.readyState,
            connectionString: dbConfig.mongoURI ? dbConfig.mongoURI.replace(/:[^:]*@/, ':******@') : ''
        };
    }
    
    // 清理过期数据的方法
    async cleanExpiredData(): Promise<void> {
        try {
            const models = [
                mongoose.model('GitHubUser'),
                mongoose.model('LeetCodeUser'),
                mongoose.model('CSDNUser'),
                mongoose.model('JueJinUser'),
                mongoose.model('BilibiliUser')
            ];
            
            for (const model of models) {
                const result = await model.deleteMany({ expireAt: { $lt: new Date() } });
                if (result.deletedCount > 0) {
                    secureLogger.info(`🧹 Cleaned ${result.deletedCount} expired documents from ${model.modelName}`);
                }
            }
        } catch (error) {
            secureLogger.error('❌ Failed to clean expired data:', error);
        }
    }
}
