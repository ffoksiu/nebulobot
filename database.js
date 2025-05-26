const mysql = require('mysql2/promise');
const logger = require('./logger');

let db_pool;

module.exports = {
    init: async (client, config) => {
        logger.db('Database module initialization requested.');
        if (!config.database || !config.database.enabled) {
            logger.db('Module disabled in config. Skipping initialization.');
            return null;
        }
        logger.db('Initializing Database module...');
        try {
            db_pool = mysql.createPool({
                host: config.database.host,
                port: config.database.port,
                user: config.database.user,
                password: config.database.password,
                database: config.database.database_name,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });
            await db_pool.getConnection();
            logger.db('MySQL connection pool established and tested successfully.');
            logger.db('Database module initialized.');
            return db_pool;
        } catch (e) {
            logger.error(`[DB] Failed to connect to MySQL database: ${e.message}`);
            logger.error('[DB] Please check your database credentials in config.json and ensure the MySQL server is running.');
            return null;
        }
    },
    get_connection: () => {
        if (!db_pool) {
            logger.error('[DB] Database pool is not initialized. Cannot get connection.');
            return null;
        }
        return db_pool;
    }
};