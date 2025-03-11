import mongoose from 'mongoose';
import { dbConfig } from '../config';
type Operation<T> = (conn: mongoose.Connection) => Promise<T>;

export class MongoDBManager {
    private static instance: MongoDBManager;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isConnected = false;

    // 修改构造函数为私有
    private constructor() { }

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
        retryWrites: true
    };

    async ensureConnection() {
        if (this.isConnected) return;
        return this.connect();
    }

    public async connect() {
        try {
            await mongoose.connect(dbConfig.mongoURI, this.config);
            this.registerEventListeners();
            this.isConnected = true;
            console.log(`MongoDB Connected: ${mongoose.connection.host}`);
        } catch (error: any) {
            this.handleConnectionError(error);
        }
    }

    public async disconnect(): Promise<void> {
        try {
            await mongoose.disconnect();
            this.isConnected = false;
            console.log('✅ MongoDB disconnected');
        } catch (error) {
            console.error('Disconnection failed:', error);
        }
    }

    private registerEventListeners() {
        mongoose.connection.on('disconnected', () => {
            this.isConnected = false;
            this.handleDisconnection();
        });

        mongoose.connection.on('reconnected', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            console.log('✅ MongoDB 连接恢复');
        });
    }

    private handleDisconnection() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            console.log(`⏳ ${delay}ms后尝试重连...`);

            setTimeout(() => {
                this.reconnectAttempts++;
                this.connect();
            }, delay);
        } else {
            console.error('❌ 达到最大重试次数，停止自动重连');
            process.exit(1);
        }
    }

    private handleConnectionError(error: Error) {
        console.error(`🔌 连接错误: ${error.message}`);
        this.handleDisconnection();
    }

    async executeOperation<T>(operation: Operation<T>) {
        await this.ensureConnection();
        return operation(mongoose.connection);
    }

    async transactionalOperation<T>(operation: Operation<T>) {
        return this.executeOperation(async (conn) => {
            const session = await conn.startSession();
            try {
                let result: T;
                await session.withTransaction(async () => {
                    result = await operation(conn);
                });
                return result!;
            } finally {
                session.endSession();
            }
        });
    }
}