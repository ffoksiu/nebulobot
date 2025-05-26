const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    underscore: "\x1b[4m",
    blink: "\x1b[5m",
    reverse: "\x1b[7m",
    hidden: "\x1b[8m",

    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",

    bgBlack: "\x1b[40m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m",
    bgYellow: "\x1b[43m",
    bgBlue: "\x1b[44m",
    bgMagenta: "\x1b[45m",
    bgCyan: "\x1b[46m",
    bgWhite: "\x1b[47m"
};

const tag_colors = {
    debug: 'magenta',
    info: 'cyan',
    warn: 'yellow',
    error: 'red',
    main: 'blue',
    db: 'green',
    tls: 'yellowBright',
    vls: 'blueBright',
    eco: 'green',
    mod: 'red',
    give: 'cyan',
    logs: 'magenta'
};

colors.yellowBright = "\x1b[93m";
colors.blueBright = "\x1b[94m";

const roman_months = [
    '', 'I', 'II', 'III', 'IV', 'V', 'VI',
    'VII', 'VIII', 'IX', 'X', 'XI', 'XII'
];

function time_get() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = roman_months[now.getMonth() + 1];
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`;
}

function log_message(tag_name, message, message_color = 'white') {
    const timestamp = time_get();
    const formatted_tag = String(tag_name).toUpperCase().padStart(5, ' ');
    const tagColorCode = colors[tag_colors[tag_name]] || colors.white;
    console.log(`${timestamp} ${tagColorCode}[${formatted_tag}]${colors.reset} ${colors[message_color]}${message}${colors.reset}`);
}

const logger = {
    debug: (message) => log_message('debug', message),
    info: (message) => log_message('info', message),
    warn: (message) => log_message('warn', message, 'yellow'),
    error: (message) => log_message('error', message, 'red'),

    main: (message) => log_message('main', message),
    db: (message) => log_message('db', message),
    tls: (message) => log_message('tls', message),
    vls: (message) => log_message('vls', message),
    eco: (message) => log_message('eco', message),
    mod: (message) => log_message('mod', message),
    give: (message) => log_message('give', message),
    logs: (message) => log_message('logs', message),

    time_get: time_get 
};

module.exports = logger;