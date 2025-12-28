import { Pool, PoolClient } from 'pg';
import { dbConfig } from '../config/db.config';
import { secureLogger } from './logger';

type Operation<T> = (client: PoolClient) => Promise<T>;

export class PostgreSQLManager {
    private static instance: PostgreSQLManager;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    public isConnected = false;
    private pool: Pool | null = null;

    // 修改构造函数为私有
    private constructor() {
    }

    public static getInstance() {
        if (!PostgreSQLManager.instance) {
            PostgreSQLManager.instance = new PostgreSQLManager();
        }
        return PostgreSQLManager.instance;
    }

    private readonly config = {
        connectionString: dbConfig.postgres.uri,
        max: dbConfig.postgres.options.max || 10,
        min: dbConfig.postgres.options.min || 5,
        connectionTimeoutMillis: dbConfig.postgres.options.connectionTimeoutMillis || 120000, // 增加到2分钟
        idleTimeoutMillis: dbConfig.postgres.options.idleTimeoutMillis || 600000, // 增加到10分钟
        keepAlive: dbConfig.postgres.options.keepAlive || true,
        keepAliveInitialDelayMillis: dbConfig.postgres.options.keepAliveInitialDelayMillis || 30000,
        ssl: dbConfig.postgres.options.ssl // 包含SSL配置
    };

    async ensureConnection(): Promise<boolean> {
        if (this.isConnected && this.pool) return true;
        try {
            await this.connect();
            return true;
        } catch (error) {
            secureLogger.warn('⚠️ PostgreSQL connection not available, will use MongoDB as backup');
            return false;
        }
    }

    public async connect(): Promise<void> {
        try {
            // 防止重复连接
            if (this.pool) {
                this.isConnected = true;
                secureLogger.debug('PostgreSQL pool already initialized');
                return;
            }
            
            // 检查连接字符串是否存在
            if (!this.config.connectionString) {
                secureLogger.warn('⚠️ PostgreSQL URI not configured, skipping connection');
                this.isConnected = false;
                return;
            }
            
            secureLogger.info('🔄 Attempting to connect to PostgreSQL...');
            
            // 初始化连接池
            this.pool = new Pool(this.config);
            
            // 测试连接
            const client = await this.pool.connect();
            await client.query('SELECT NOW()');
            client.release();
            
            this.registerEventListeners();
            this.isConnected = true;
            this.reconnectAttempts = 0;
            secureLogger.info(`✅ PostgreSQL Connected: ${this.config.connectionString}`);
        } catch (error: any) {
            this.handleConnectionError(error);
            this.isConnected = false;
            secureLogger.warn('⚠️ PostgreSQL connection failed, will use MongoDB as backup');
            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            if (this.pool) {
                await this.pool.end();
                this.pool = null;
                this.isConnected = false;
                secureLogger.info('✅ PostgreSQL disconnected');
            }
        } catch (error) {
            secureLogger.error('❌ PostgreSQL disconnection failed:', error);
        }
    }

    private registerEventListeners() {
        if (!this.pool) return;
        
        this.pool.on('acquire', () => {
            secureLogger.debug('🔗 PostgreSQL client acquired');
        });

        this.pool.on('connect', () => {
            secureLogger.debug('🔌 PostgreSQL client connected');
        });

        this.pool.on('remove', () => {
            secureLogger.debug('🗑️  PostgreSQL client removed');
        });

        this.pool.on('error', (error) => {
            secureLogger.error(`❌ PostgreSQL pool error: ${error.message}`);
            this.handleConnectionError(error);
        });
    }

    private handleDisconnection() {
        if (!this.isConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            secureLogger.info(`🔄 Attempting to reconnect to PostgreSQL... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            // 使用指数退避策略进行重连
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000); // 最大30秒延迟
            setTimeout(() => {
                this.connect().catch(err => {
                    secureLogger.warn(`⚠️ Reconnection attempt ${this.reconnectAttempts} failed: ${err.message}`);
                    this.handleDisconnection(); // 递归调用继续尝试重连
                });
            }, delay);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            secureLogger.error('❌ Maximum reconnection attempts reached. Giving up.');
            this.reconnectAttempts = 0; // 重置尝试次数，允许在下次断开连接时重新尝试
        }
    }

    private handleConnectionError(error: Error) {
        secureLogger.error(`❌ PostgreSQL connection error: ${error.message}`, {
            stack: error.stack,
            name: error.name
        });
        this.isConnected = false;
        // 尝试重连
        this.handleDisconnection();
    }

    async executeOperation<T>(operation: Operation<T>, fallback?: () => Promise<T>): Promise<T> {
        try {
            const isConnected = await this.ensureConnection();
            if (isConnected && this.pool) {
                const client = await this.pool.connect();
                try {
                    return await operation(client);
                } finally {
                    client.release();
                }
            } else if (fallback) {
                secureLogger.warn('⚠️ PostgreSQL not available, using fallback operation');
                return await fallback();
            } else {
                secureLogger.warn('⚠️ PostgreSQL not available and no fallback provided');
                throw new Error('PostgreSQL not available and no fallback provided');
            }
        } catch (error: any) {
            secureLogger.error(`❌ PostgreSQL operation failed: ${error.message}`);
            if (fallback) {
                secureLogger.warn('⚠️ Using fallback operation after PostgreSQL error');
                return await fallback();
            }
            throw error;
        }
    }

    async transactionalOperation<T>(operation: Operation<T>, fallback?: () => Promise<T>): Promise<T> {
        try {
            const isConnected = await this.ensureConnection();
            if (isConnected && this.pool) {
                const client = await this.pool.connect();
                try {
                    await client.query('BEGIN');
                    const result = await operation(client);
                    await client.query('COMMIT');
                    return result;
                } catch (error) {
                    await client.query('ROLLBACK');
                    secureLogger.error('❌ Transaction aborted:', error);
                    throw error;
                } finally {
                    client.release();
                }
            } else if (fallback) {
                secureLogger.warn('⚠️ PostgreSQL not available, using fallback operation instead of transaction');
                return await fallback();
            } else {
                throw new Error('PostgreSQL not available and no fallback provided for transaction');
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
        poolSize: number | null;
        connectionString: string;
    } {
        return {
            isConnected: this.isConnected,
            poolSize: this.pool ? this.config.max : null,
            connectionString: this.config.connectionString ? this.config.connectionString.replace(/:[^:]*@/, ':******@') : ''
        };
    }
    
    // 初始化表结构
    async initializeDatabase(): Promise<void> {
        try {
            await this.executeOperation(async (client) => {
                // 创建键值存储表
                await client.query(`
                    CREATE TABLE IF NOT EXISTS key_value_store (
                        id SERIAL PRIMARY KEY,
                        key VARCHAR(255) UNIQUE NOT NULL,
                        value JSONB NOT NULL,
                        ttl INTEGER,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        expire_at TIMESTAMP WITH TIME ZONE,
                        CONSTRAINT unique_key UNIQUE (key)
                    );
                `);
                
                // 创建GitHub用户表
                await client.query(`
                    CREATE TABLE IF NOT EXISTS github_users (
                        id SERIAL PRIMARY KEY,
                        login VARCHAR(255) UNIQUE NOT NULL,
                        user_data JSONB NOT NULL,
                        ttl INTEGER,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        expire_at TIMESTAMP WITH TIME ZONE
                    );
                `);
                
                // 创建GitHub用户访问记录表
                await client.query(`
                    CREATE TABLE IF NOT EXISTS github_user_visit (
                        id SERIAL PRIMARY KEY,
                        username VARCHAR(255) UNIQUE NOT NULL,
                        visit_count INTEGER DEFAULT 1,
                        visit_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        avatar_url TEXT,
                        last_visited TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                        avatar_updated_at TIMESTAMP WITH TIME ZONE,
                        CONSTRAINT unique_github_username UNIQUE (username)
                    );
                `);
                
                // 创建索引
                await client.query(`
                    CREATE INDEX IF NOT EXISTS idx_key_value_store_key ON key_value_store (key);
                    CREATE INDEX IF NOT EXISTS idx_key_value_store_expire_at ON key_value_store (expire_at);
                    CREATE INDEX IF NOT EXISTS idx_github_users_login ON github_users (login);
                    CREATE INDEX IF NOT EXISTS idx_github_users_expire_at ON github_users (expire_at);
                    CREATE INDEX IF NOT EXISTS idx_github_user_visit_username ON github_user_visit (username);
                    CREATE INDEX IF NOT EXISTS idx_github_user_visit_visit_time ON github_user_visit (visit_time);
                `);
                
                secureLogger.info('✅ PostgreSQL tables initialized successfully');
            });
        } catch (error) {
            secureLogger.error('❌ Failed to initialize PostgreSQL database:', error);
            // 不抛出错误，允许应用继续运行
        }
    }
    
    // 清理过期数据的方法
    async cleanExpiredData(): Promise<void> {
        try {
            await this.executeOperation(async (client) => {
                // 清理过期的键值存储
                const kvResult = await client.query(`
                    DELETE FROM key_value_store 
                    WHERE expire_at IS NOT NULL AND expire_at < CURRENT_TIMESTAMP
                `);
                
                // 清理过期的GitHub用户数据
                const ghResult = await client.query(`
                    DELETE FROM github_users 
                    WHERE expire_at IS NOT NULL AND expire_at < CURRENT_TIMESTAMP
                `);
                
                const kvCleaned = kvResult.rowCount || 0;
                const ghCleaned = ghResult.rowCount || 0;
                
                if (kvCleaned > 0) {
                    secureLogger.info(`🧹 Cleaned ${kvCleaned} expired documents from key_value_store`);
                }
                
                if (ghCleaned > 0) {
                    secureLogger.info(`🧹 Cleaned ${ghCleaned} expired documents from github_users`);
                }
            });
        } catch (error) {
            secureLogger.error('❌ Failed to clean expired PostgreSQL data:', error);
        }
    }
    
    // GitHub用户访问数据操作方法
    
    /**
     * 获取GitHub用户访问数据
     * @param username GitHub用户名
     * @returns 用户访问数据对象
     */
    async getGitHubUserVisit(username: string): Promise<{
        username: string;
        visit_count: number;
        last_visited: Date;
        avatar_url?: string;
        avatar_updated_at?: Date;
    } | null> {
        try {
            return await this.executeOperation(async (client) => {
                const query = `
                    SELECT username, visit_count, last_visited, avatar_url, 
                           avatar_updated_at
                    FROM github_user_visit
                    WHERE username = $1
                `;
                const res = await client.query(query, [username]);
                
                if (res.rows.length === 0) {
                    return null;
                }
                
                const row = res.rows[0];
                return {
                    username: row.username,
                    visit_count: row.visit_count,
                    last_visited: new Date(row.last_visited),
                    avatar_url: row.avatar_url,
                    avatar_updated_at: row.avatar_updated_at ? new Date(row.avatar_updated_at) : undefined
                };
            });
        } catch (error) {
            secureLogger.error(`❌ Failed to get GitHub user visit data for ${username}:`, error);
            return null;
        }
    }
    
    /**
     * 更新GitHub用户访问数据
     * @param username GitHub用户名
     * @param data 更新的数据
     * @returns 更新后的数据
     */
    async updateGitHubUserVisit(
        username: string, 
        data: {
            visit_count?: number;
            avatar_url?: string;
            avatar_updated_at?: Date;
        }
    ): Promise<{
        username: string;
        visit_count: number;
        last_visited: Date;
        avatar_url?: string;
        avatar_updated_at?: Date;
    } | null> {
        try {
            return await this.executeOperation(async (client) => {
                const currentDate = new Date();
                
                // 构建更新查询
                const query = `
                    INSERT INTO github_user_visit (
                        username, visit_count, last_visited, avatar_url, 
                        last_updated, avatar_updated_at
                    )
                    VALUES (
                        $1, COALESCE($2, 1), $3, $4, $5, $6
                    )
                    ON CONFLICT (username)
                    DO UPDATE SET
                        visit_count = COALESCE($2, github_user_visit.visit_count + 1),
                        last_visited = $3,
                        last_updated = $5,
                        avatar_url = COALESCE($4, github_user_visit.avatar_url),
                        avatar_updated_at = COALESCE($6, github_user_visit.avatar_updated_at)
                    RETURNING username, visit_count, last_visited, avatar_url, avatar_updated_at
                `;
                
                const res = await client.query(query, [
                    username,
                    data.visit_count,
                    currentDate,
                    data.avatar_url,
                    currentDate,
                    data.avatar_updated_at
                ]);
                
                if (res.rows.length === 0) {
                    return null;
                }
                
                const row = res.rows[0];
                return {
                    username: row.username,
                    visit_count: row.visit_count,
                    last_visited: new Date(row.last_visited),
                    avatar_url: row.avatar_url,
                    avatar_updated_at: row.avatar_updated_at ? new Date(row.avatar_updated_at) : undefined
                };
            });
        } catch (error) {
            secureLogger.error(`❌ Failed to update GitHub user visit data for ${username}:`, error);
            return null;
        }
    }
}