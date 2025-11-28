import mongoose, { Connection } from 'mongoose';
import {dbConfig} from '../config';
import {secureLogger} from './logger';

type Operation<T> = (conn: mongoose.Connection) => Promise<T>;

export class MongoDBManager {
    private static instance: MongoDBManager;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isConnected = false;

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
        maxPoolSize: 20,
        minPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        retryReads: true,
        retryWrites: true,
        heartbeatFrequencyMS: 10000,
        connectTimeoutMS: 30000,
        family: 4 // 优先使用IPv4
    };

    async ensureConnection(): Promise<void> {
        if (this.isConnected && mongoose.connection.readyState === 1) return;
        return this.connect();
    }

    public async connect(): Promise<void> {
        try {
            // 防止重复连接
            if (mongoose.connection.readyState === 1) {
                this.isConnected = true;
                return;
            }
            
            await mongoose.connect(dbConfig.mongoURI, this.config);
            this.registerEventListeners();
            this.isConnected = true;
            secureLogger.info(`✅ MongoDB Connected: ${mongoose.connection.host}`);
        } catch (error: any) {
            this.handleConnectionError(error);
            // 抛出错误，让调用者决定如何处理
            throw new Error(`Database connection failed: ${error.message}`);
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
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            secureLogger.warn(`🔄 MongoDB reconnection attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts} in ${delay}ms`);

            setTimeout(() => {
                this.reconnectAttempts++;
                // 不抛出错误，避免中断程序
                this.connect().catch(error => {
                    secureLogger.error(`❌ Reconnection failed: ${error.message}`);
                });
            }, delay);
        } else {
            secureLogger.error('❌ Max MongoDB reconnection attempts reached');
            // 不直接退出程序，让应用能够继续运行（使用缓存或降级策略）
            this.isConnected = false;
        }
    }

    private handleConnectionError(error: Error) {
        secureLogger.error(`❌ MongoDB connection error: ${error.message}`);
        this.handleDisconnection();
    }

    async executeOperation<T>(operation: Operation<T>): Promise<T> {
        try {
            await this.ensureConnection();
            return await operation(mongoose.connection);
        } catch (error) {
            secureLogger.error('❌ Database operation failed:', error);
            throw error;
        }
    }

    async transactionalOperation<T>(operation: Operation<T>): Promise<T> {
        return this.executeOperation(async (conn) => {
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
