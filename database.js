const { log_db, log_warn, log_error, log_debug } = require('./utils');
const mysql = require('mysql2/promise');

module.exports = {
    init: async (client, config) => {
        log_debug('[Database] Checking database configuration...');
        if (!config.database || !config.database.enabled) {
            log_warn('[Database] Module disabled in configuration.');
            log_debug('[Database] Database module initialization skipped.');
            return;
        }
        log_db('[Database] Initializing module...');
        log_debug('[Database] Configuration check passed. Proceeding with initialization.');
        try {
            log_db('[Database] Attempting to connect to MySQL...');
            log_debug(`[Database] MySQL host: ${config.database.host}`);
            log_debug(`[Database] MySQL port: ${config.database.port}`);
            log_debug(`[Database] MySQL user: ${config.database.user}`);
            log_debug(`[Database] MySQL database name: ${config.database.database_name}`);

            const connection = await mysql.createConnection({
                host: config.database.host,
                port: config.database.port,
                user: config.database.user,
                password: config.database.password,
                database: config.database.database_name,
            });

            await connection.connect();
            log_db('[Database] Successfully connected to MySQL database.');
            client.db = connection;

            log_debug('[Database] MySQL connection stored in client object.');
            log_db('[Database] Module initialized.');
            log_debug('[Database] Database module fully initialized.');
        } catch (e) {
            log_error(`[Database] Failed to initialize module: ${e.message}`);
            log_debug(`[Database] Error during database initialization: ${e.stack}`);
        }
    }
};