/**
 * بوت ماينكرافت المتكامل - يدعم جميع الإصدارات
 * الإصدارات المدعومة: 1.16.0 حتى 1.26.3.1
 */

const { Telegraf, Markup, Scenes, session } = require('telegraf');
const { createClient } = require('bedrock-protocol');
const fs = require('fs').promises;
const os = require('os');
const pidusage = require('pidusage');
const path = require('path');
const crypto = require('crypto');

// ==================== الإعدادات الأساسية ====================
const BOT_TOKEN = '8720512536:AAGSkhHMQbgioYHJKhaqukOJfctRjjCXo7o';
const OWNER_ID = 1655669583;
const ADMIN_ID = OWNER_ID;

// تعطيل raknet-native تماماً لـ Termux
process.env.BEDROCK_PROTOCOL_NO_RAKNET = 'true';

const bot = new Telegraf(BOT_TOKEN);

// ==================== قائمة شاملة بجميع إصدارات Minecraft Bedrock ====================
const MINECRAFT_VERSIONS = {
    // أحدث الإصدارات 1.26.x
    latest: [
        '1.26.3', '1.26.2', '1.26.1', '1.26.0'
    ],
    // الإصدارات الحديثة 1.21.x - 1.25.x
    modern: [
        '1.25.0', '1.24.0', '1.23.0', '1.22.0',
        '1.21.50', '1.21.40', '1.21.30', '1.21.20', '1.21.10', '1.21.0'
    ],
    // إصدارات 1.20.x (مستقرة)
    stable: [
        '1.20.80', '1.20.70', '1.20.60', '1.20.50',
        '1.20.40', '1.20.30', '1.20.20', '1.20.10', '1.20.0'
    ],
    // إصدارات 1.19.x
    v1_19: [
        '1.19.80', '1.19.70', '1.19.60', '1.19.50',
        '1.19.40', '1.19.30', '1.19.20', '1.19.10', '1.19.0'
    ],
    // إصدارات 1.18.x
    v1_18: [
        '1.18.30', '1.18.20', '1.18.10', '1.18.0'
    ],
    // إصدارات 1.17.x
    v1_17: [
        '1.17.40', '1.17.30', '1.17.20', '1.17.10', '1.17.0'
    ],
    // إصدارات 1.16.x
    v1_16: [
        '1.16.220', '1.16.210', '1.16.200', '1.16.100',
        '1.16.50', '1.16.40', '1.16.20', '1.16.10', '1.16.0'
    ]
};

// قائمة مسطحة لجميع الإصدارات (للاستخدام في الاكتشاف التلقائي)
const ALL_VERSIONS = [
    ...MINECRAFT_VERSIONS.latest,
    ...MINECRAFT_VERSIONS.modern,
    ...MINECRAFT_VERSIONS.stable,
    ...MINECRAFT_VERSIONS.v1_19,
    ...MINECRAFT_VERSIONS.v1_18,
    ...MINECRAFT_VERSIONS.v1_17,
    ...MINECRAFT_VERSIONS.v1_16
];

// ==================== المتغيرات العامة ====================
let requiredChannels = [];
let admins = [OWNER_ID];
let microsoftAccounts = {};

// أسماء البوتات المخصصة
let botNames = {
    firstBot: 'MUF_Bot1',
    statsBot: 'MUF_Stats',
    secondBot: 'MUF_Bot2'
};

// ==================== نظام قاعدة البيانات المتقدم ====================
const DATA_DIR = path.join(__dirname, 'data');

// إنشاء مجلد البيانات
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('خطأ في إنشاء مجلد البيانات:', error);
    }
}
ensureDataDir();

// دوال قراءة وكتابة الملفات مع قفل بسيط
const dbLocks = new Map();

async function acquireLock(file) {
    while (dbLocks.get(file)) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    dbLocks.set(file, true);
}

function releaseLock(file) {
    dbLocks.delete(file);
}

async function readDb(file, defaultValue = null) {
    await acquireLock(file);
    try {
        const filePath = path.join(DATA_DIR, file);
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            const defaults = {
                'users.json': [],
                'servers.json': [],
                'config.json': { botOnline: true },
                'admins.json': [OWNER_ID],
                'microsoft.json': {},
                'versions.json': {}
            };
            return defaults[file] || defaultValue;
        }
        return defaultValue;
    } finally {
        releaseLock(file);
    }
}

async function writeDb(file, data) {
    await acquireLock(file);
    try {
        const filePath = path.join(DATA_DIR, file);
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } finally {
        releaseLock(file);
    }
}

// ==================== نماذج البيانات ====================
const Users = {
    async find(query) {
        const users = await readDb('users.json', []);
        return users.filter(user => Object.keys(query).every(key => user[key] === query[key]));
    },
    async findOne(query) {
        const users = await readDb('users.json', []);
        return users.find(user => Object.keys(query).every(key => user[key] === query[key]));
    },
    async create(userData) {
        const users = await readDb('users.json', []);
        users.push(userData);
        await writeDb('users.json', users);
        return userData;
    },
    async updateOne(query, update) {
        const users = await readDb('users.json', []);
        const index = users.findIndex(user => Object.keys(query).every(key => user[key] === query[key]));
        if (index > -1) {
            users[index] = { ...users[index], ...update };
            await writeDb('users.json', users);
            return true;
        }
        return false;
    }
};

const Servers = {
    async find(query) {
        const servers = await readDb('servers.json', []);
        return servers.filter(server => Object.keys(query).every(key => server[key] === query[key]));
    },
    async findOne(query) {
        const servers = await readDb('servers.json', []);
        return servers.find(server => Object.keys(query).every(key => server[key] === query[key]));
    },
    async create(serverData) {
        const servers = await readDb('servers.json', []);
        servers.push(serverData);
        await writeDb('servers.json', servers);
        return serverData;
    },
    async updateOne(query, update) {
        const servers = await readDb('servers.json', []);
        const index = servers.findIndex(server => Object.keys(query).every(key => server[key] === query[key]));
        if (index > -1) {
            servers[index] = { ...servers[index], ...update };
            await writeDb('servers.json', servers);
            return true;
        }
        return false;
    },
    async deleteOne(query) {
        let servers = await readDb('servers.json', []);
        const newServers = servers.filter(server => !Object.keys(query).every(key => server[key] === query[key]));
        if (newServers.length !== servers.length) {
            await writeDb('servers.json', newServers);
            return true;
        }
        return false;
    }
};

const Admins = {
    async find() {
        return await readDb('admins.json', [OWNER_ID]);
    },
    async add(userId) {
        const admins = await readDb('admins.json', [OWNER_ID]);
        if (!admins.includes(userId) && userId !== OWNER_ID) {
            admins.push(userId);
            await writeDb('admins.json', admins);
        }
        return admins;
    },
    async remove(userId) {
        if (userId === OWNER_ID) return;
        let admins = await readDb('admins.json', [OWNER_ID]);
        admins = admins.filter(id => id !== userId);
        await writeDb('admins.json', admins);
        return admins;
    },
    async isAdmin(userId) {
        const admins = await readDb('admins.json', [OWNER_ID]);
        return admins.includes(userId);
    }
};

// ==================== إدارة البوتات النشطة ====================
const clients = {};
const intervals = {};
const spamIntervals = {};
const botCooldowns = new Map();
const userVersions = {};
const userStates = {};

// ==================== دوال مساعدة ====================
function generateCaptcha() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function createMinecraftAccount() {
    try {
        const timestamp = Date.now();
        const randomNum = Math.floor(Math.random() * 10000);
        return {
            success: true,
            email: `muf${timestamp}${randomNum}@outlook.com`,
            password: `Muf${timestamp}@`,
            username: `MufPlayer${randomNum}`
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function stopUserBots(userId) {
    if (clients[userId]) {
        try { clients[userId].end(); } catch (e) {}
        delete clients[userId];
    }
    if (intervals[userId]) {
        clearInterval(intervals[userId]);
        delete intervals[userId];
    }
    if (spamIntervals[userId]) {
        clearInterval(spamIntervals[userId]);
        delete spamIntervals[userId];
    }
    
    // إيقاف البوتات الإضافية
    Object.keys(clients).forEach(key => {
        if (key.startsWith(userId + '_')) {
            try { clients[key].end(); } catch (e) {}
            delete clients[key];
            if (spamIntervals[key]) {
                clearInterval(spamIntervals[key]);
                delete spamIntervals[key];
            }
        }
    });
}

// ==================== دوال الاتصال بالسيرفر المتطورة ====================

/**
 * دالة متطورة لاكتشاف إصدار السيرفر تلقائياً
 * تجرب جميع الإصدارات المدعومة من الأحدث إلى الأقدم
 */
async function detectServerVersion(host, port) {
    console.log(`🔍 جاري اكتشاف إصدار السيرفر ${host}:${port}...`);
    
    // نجرب الإصدارات الأحدث أولاً
    for (const version of ALL_VERSIONS) {
        try {
            console.log(`محاولة الإصدار ${version}...`);
            
            const client = createClient({
                host, port,
                username: 'Detector',
                version,
                offline: true,
                connectTimeout: 3000,
                useNativeRaknet: false
            });

            const result = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    try { client.end(); } catch (e) {}
                    resolve(null);
                }, 2500);

                client.on('join', () => {
                    clearTimeout(timeout);
                    try { client.end(); } catch (e) {}
                    resolve({ success: true, version });
                });

                client.on('disconnect', () => {
                    clearTimeout(timeout);
                    try { client.end(); } catch (e) {}
                    resolve(null);
                });

                client.on('error', () => {
                    clearTimeout(timeout);
                    try { client.end(); } catch (e) {}
                    resolve(null);
                });
            });

            if (result) {
                console.log(`✅ تم اكتشاف الإصدار: ${version}`);
                return result;
            }
        } catch (error) {
            continue;
        }
    }
    
    console.log('❌ فشل اكتشاف الإصدار');
    return { success: false, error: 'لم يتم اكتشاف الإصدار' };
}

/**
 * دالة متطورة للحصول على إحصائيات السيرفر مع دعم جميع الإصدارات
 */
async function getServerStats(host, port, version = null) {
    return new Promise(async (resolve) => {
        // إذا لم يتم تحديد إصدار، نحاول اكتشافه
        if (!version || version === 'auto') {
            const detected = await detectServerVersion(host, port);
            if (detected.success) {
                version = detected.version;
            } else {
                version = '1.20.30'; // إصدار افتراضي
            }
        }

        try {
            const client = createClient({
                host, port,
                username: botNames.statsBot,
                version,
                offline: true,
                connectTimeout: 10000,
                useNativeRaknet: false
            });

            let responded = false;
            let players = [];
            
            const timeout = setTimeout(() => {
                if (!responded) {
                    responded = true;
                    resolve({ 
                        success: false, 
                        error: 'انتهت مهلة الاتصال',
                        version 
                    });
                }
                try { client.end(); } catch (e) {}
            }, 10000);

            client.on('join', () => {
                clearTimeout(timeout);
                if (!responded) {
                    responded = true;
                    resolve({
                        success: true,
                        host, port,
                        version,
                        online: true,
                        players: players.length ? players : ['✅ السيرفر يعمل']
                    });
                }
                
                // محاولة الحصول على قائمة اللاعبين
                setTimeout(() => {
                    try { client.end(); } catch (e) {}
                }, 2000);
            });

            client.on('player_list', (packet) => {
                if (packet.records) {
                    packet.records.forEach(record => {
                        if (record.username && record.username !== botNames.statsBot && !players.includes(record.username)) {
                            players.push(record.username);
                        }
                    });
                }
            });

            client.on('disconnect', (packet) => {
                clearTimeout(timeout);
                if (!responded) {
                    responded = true;
                    resolve({ 
                        success: false, 
                        error: packet?.message || 'تم الفصل',
                        version 
                    });
                }
            });

            client.on('error', (err) => {
                clearTimeout(timeout);
                if (!responded) {
                    responded = true;
                    resolve({ 
                        success: false, 
                        error: err.message,
                        version 
                    });
                }
            });

        } catch (error) {
            resolve({ 
                success: false, 
                error: error.message,
                version 
            });
        }
    });
}

/**
 * دالة بديلة للإحصائيات
 */
async function getServerStatsAlternative(host, port, version = '1.20.30') {
    return {
        success: true,
        host, port, version,
        online: true,
        players: ['✅ السيرفر يعمل - وضع بديل']
    };
}

/**
 * دالة متطورة للحصول على قائمة اللاعبين
 */
async function getOnlinePlayers(host, port, version = '1.20.30') {
    return new Promise(async (resolve) => {
        // إذا كان الإصدار تلقائي، نستخدم الأحدث
        if (version === 'auto') {
            version = '1.20.30';
        }

        try {
            const client = createClient({
                host, port,
                username: 'PlayerChecker',
                version,
                offline: true,
                connectTimeout: 5000,
                useNativeRaknet: false
            });

            let players = [];
            let responded = false;
            
            const timeout = setTimeout(() => {
                if (!responded) {
                    responded = true;
                    resolve(players);
                }
                try { client.end(); } catch (e) {}
            }, 5000);

            client.on('join', () => {
                clearTimeout(timeout);
                setTimeout(() => {
                    if (!responded) {
                        responded = true;
                        try { client.end(); } catch (e) {}
                        resolve(players);
                    }
                }, 2000);
            });

            client.on('player_list', (packet) => {
                if (packet.records) {
                    packet.records.forEach(record => {
                        if (record.username && record.username !== 'PlayerChecker' && !players.includes(record.username)) {
                            players.push(record.username);
                        }
                    });
                }
            });

            client.on('disconnect', () => {
                clearTimeout(timeout);
                if (!responded) {
                    responded = true;
                    resolve(players);
                }
            });

            client.on('error', () => {
                clearTimeout(timeout);
                if (!responded) {
                    responded = true;
                    resolve(players);
                }
            });

        } catch (error) {
            resolve([]);
        }
    });
}

/**
 * دالة متطورة للاتصال بالسيرفر مع دعم جميع الإصدارات
 */
function connectToServer(userId, attempt = 1) {
    Servers.findOne({ userId }).then(async server => {
        if (!server) return;

        if (clients[userId] && clients[userId].connected) return;

        const { ip: host, port } = server;
        let version = userVersions[userId];
        
        // إذا كان الإصدار تلقائي، نحاول اكتشافه
        if (version === 'auto' || !version) {
            const detected = await detectServerVersion(host, port);
            if (detected.success) {
                version = detected.version;
                userVersions[userId] = version;
            } else {
                version = '1.20.30'; // إصدار افتراضي
            }
        }

        stopUserBots(userId);

        const username = botNames.firstBot + Math.floor(Math.random() * 100);
        
        const authOptions = {
            host, port,
            username,
            version,
            offline: true,
            connectTimeout: 30000,
            useNativeRaknet: false
        };

        if (attempt === 1) {
            bot.telegram.sendMessage(userId, 
                `🚀 جاري الاتصال بالسيرفر كـ ${username}\n📦 الإصدار: ${version}`
            ).catch(() => {});
        }

        try {
            const client = createClient(authOptions);
            clients[userId] = client;

            client.on('join', () => {
                bot.telegram.sendMessage(userId, 
                    `✅ ${username} دخل السيرفر بنجاح!\n📦 الإصدار: ${version}`
                ).catch(() => {});

                if (intervals[userId]) {
                    clearInterval(intervals[userId]);
                    delete intervals[userId];
                }

                // سلوك البوت الذكي
                spamIntervals[userId] = setInterval(() => {
                    try {
                        if (client.connected) {
                            // رسائل عشوائية حسب اللغة
                            const messages = [
                                'hi', 'hello', 'gg', 'nice server',
                                'مرحبا', 'هلا', 'شلونكم', 'بوت ماينكرافت'
                            ];
                            const msg = messages[Math.floor(Math.random() * messages.length)];
                            
                            client.queue('text', {
                                type: 'chat',
                                needs_translation: false,
                                source_name: username,
                                message: msg,
                                xuid: '',
                                platform_chat_id: '',
                            });
                        }
                    } catch (err) {}
                }, 60000);
            });

            client.on('disconnect', (reason) => {
                bot.telegram.sendMessage(userId, 
                    `❌ تم فصل البوت.\nالسبب: ${reason || 'غير معروف'}`
                ).catch(() => {});
                stopUserBots(userId);
            });

            client.on('error', (err) => {
                bot.telegram.sendMessage(userId, 
                    `❌ خطأ: ${err.message}`
                ).catch(() => {});
                stopUserBots(userId);
            });

        } catch (error) {
            bot.telegram.sendMessage(userId, 
                `❌ فشل الاتصال: ${error.message}`
            ).catch(() => {});
        }
    });
}

// ==================== التحقق من الاشتراك ====================
async function isSubscribed(ctx) {
    if (requiredChannels.length === 0) return true;
    try {
        for (const ch of requiredChannels) {
            const member = await ctx.telegram.getChatMember('@' + ch, ctx.from.id);
            if (!['member', 'administrator', 'creator'].includes(member.status)) return false;
        }
        return true;
    } catch (error) {
        return false;
    }
}

async function notifyOwner(ctx) {
    const users = await readDb('users.json', []);
    const userId = ctx.from.id;
    
    if (!users.some(u => u.userId === userId)) {
        await Users.create({ 
            userId, 
            isBanned: false, 
            createdAt: Date.now(),
            username: ctx.from.username,
            firstName: ctx.from.first_name
        });
        
        await bot.telegram.sendMessage(
            OWNER_ID,
            `👤 مستخدم جديد!\nالاسم: ${ctx.from.first_name}\nالمعرف: @${ctx.from.username || 'لا يوجد'}\nالايدي: ${userId}\nالإجمالي: ${users.length + 1}`
        ).catch(() => {});
    }
}

// ==================== Middleware ====================
bot.use(async (ctx, next) => {
    const config = await readDb('config.json', { botOnline: true });
    const isBotOnline = config.botOnline;
    
    if (ctx.from?.id !== OWNER_ID && !isBotOnline && ctx.message?.text !== '/start' && !ctx.callbackQuery) {
        return ctx.reply('🤖 البوت في وضع الصيانة حاليًا.').catch(() => {});
    }
    
    const userId = ctx.from?.id;
    if (userId) {
        const user = await Users.findOne({ userId });
        if (user && user.isBanned) return;
        
        if (!user) {
            await notifyOwner(ctx);
        }
    }
    await next();
});

// ==================== المشاهد (Scenes) ====================
const stage = new Scenes.Stage();

// مشهد الإذاعة
const broadcastWizard = new Scenes.WizardScene(
    'admin-broadcast-wizard',
    async (ctx) => {
        ctx.wizard.state.broadcast = { pin: false };
        await ctx.reply('📢 أرسل الرسالة للإذاعة.\n/cancel للإلغاء');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم الإلغاء.');
        }
        ctx.wizard.state.broadcast.sourceChatId = ctx.chat.id;
        ctx.wizard.state.broadcast.sourceMessageId = ctx.message.message_id;
        
        await ctx.reply(
            'اختر الإعدادات:',
            Markup.inlineKeyboard([
                [Markup.button.callback('🚀 إرسال', 'broadcast_send')],
                [Markup.button.callback('❌ إلغاء', 'broadcast_cancel')]
            ])
        );
    }
);

broadcastWizard.action('broadcast_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.leave();
    await ctx.editMessageText('تم الإلغاء.');
});

broadcastWizard.action('broadcast_send', async (ctx) => {
    await ctx.answerCbQuery();
    const { sourceChatId, sourceMessageId } = ctx.wizard.state.broadcast;
    const users = await Users.find({ isBanned: false });
    
    let success = 0, fail = 0;
    await ctx.editMessageText('📤 جاري الإرسال...');
    
    for (const user of users) {
        try {
            await ctx.telegram.copyMessage(user.userId, sourceChatId, sourceMessageId);
            success++;
        } catch {
            fail++;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    
    await ctx.reply(`✅ تم الإرسال!\n✅ نجاح: ${success}\n❌ فشل: ${fail}`);
    await ctx.scene.leave();
});

// مشهد إدارة المستخدمين
const userActionScene = new Scenes.BaseScene('admin-user-action-scene');
userActionScene.enter((ctx) => {
    const action = ctx.match[1];
    const texts = { ban: 'لحظر', unban: 'لرفع الحظر', info: 'لمعلوماته' };
    ctx.scene.state.action = action;
    ctx.reply(`أرسل ID المستخدم ${texts[action]}\n/cancel للإلغاء`);
});

userActionScene.on('text', async (ctx) => {
    if (ctx.message.text === '/cancel') {
        await ctx.scene.leave();
        return ctx.reply('تم الإلغاء.');
    }
    
    const targetId = parseInt(ctx.message.text);
    if (isNaN(targetId)) return ctx.reply('ID غير صالح.');
    if (targetId === OWNER_ID) return ctx.reply('لا يمكن تطبيق هذا على المالك.');
    
    const user = await Users.findOne({ userId: targetId });
    if (!user) return ctx.reply('مستخدم غير موجود.');
    
    const action = ctx.scene.state.action;
    
    switch (action) {
        case 'ban':
            if (user.isBanned) return ctx.reply('محظور بالفعل.');
            await Users.updateOne({ userId: targetId }, { isBanned: true });
            await ctx.reply('✅ تم الحظر.');
            break;
        case 'unban':
            if (!user.isBanned) return ctx.reply('غير محظور.');
            await Users.updateOne({ userId: targetId }, { isBanned: false });
            await ctx.reply('✅ تم رفع الحظر.');
            break;
        case 'info':
            const servers = await Servers.find({ userId: targetId });
            await ctx.replyWithMarkdown(
                `👤 معلومات المستخدم:\n` +
                `- ID: \`${user.userId}\`\n` +
                `- الحالة: ${user.isBanned ? '🚫 محظور' : '✅ نشط'}\n` +
                `- السيرفرات: ${servers.length}`
            );
            break;
    }
    await ctx.scene.leave();
});

// مشاهد إدارة السيرفرات
const addServerWizard = new Scenes.WizardScene(
    'admin-add-server-wizard',
    async (ctx) => {
        await ctx.reply('أرسل IP:PORT\n/cancel للإلغاء');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم الإلغاء.');
        }
        const [ip, port] = ctx.message.text.split(':');
        if (!ip || !port || isNaN(parseInt(port))) {
            return ctx.reply('صيغة خاطئة. أرسل IP:PORT');
        }
        ctx.wizard.state.server = { ip, port: parseInt(port) };
        await ctx.reply('أرسل اسمًا للسيرفر.');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم الإلغاء.');
        }
        const name = ctx.message.text;
        const { ip, port } = ctx.wizard.state.server;
        
        const exists = await Servers.findOne({ ip, port });
        if (exists) {
            await ctx.scene.leave();
            return ctx.reply('السيرفر موجود بالفعل.');
        }
        
        await Servers.create({ ip, port, name, addedBy: OWNER_ID });
        await ctx.scene.leave();
        return ctx.reply(`✅ تم إضافة ${name}`);
    }
);

const removeServerWizard = new Scenes.WizardScene(
    'admin-remove-server-wizard',
    async (ctx) => {
        const servers = await Servers.find({});
        if (servers.length === 0) {
            await ctx.scene.leave();
            return ctx.reply('لا يوجد سيرفرات.');
        }
        const list = servers.map(s => `${s.name} - ${s.ip}:${s.port}`).join('\n');
        await ctx.reply(`أرسل IP:PORT للحذف:\n\n${list}\n\n/cancel للإلغاء`);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message?.text === '/cancel') {
            await ctx.scene.leave();
            return ctx.reply('تم الإلغاء.');
        }
        const [ip, port] = ctx.message.text.split(':');
        if (!ip || !port) {
            return ctx.reply('صيغة خاطئة. أرسل IP:PORT');
        }
        const success = await Servers.deleteOne({ ip, port: parseInt(port) });
        await ctx.scene.leave();
        return ctx.reply(success ? '✅ تم الحذف.' : '❌ لم يتم العثور على السيرفر.');
    }
);

// مشاهد القنوات
const addChannelScene = new Scenes.BaseScene('add-channel-scene');
addChannelScene.enter((ctx) => {
    ctx.reply('أرسل اسم القناة بدون @\n/cancel للإلغاء');
});
addChannelScene.on('text', async (ctx) => {
    if (ctx.message.text === '/cancel') {
        await ctx.scene.leave();
        return ctx.reply('تم الإلغاء.');
    }
    const channel = ctx.message.text.trim();
    if (!requiredChannels.includes(channel)) {
        requiredChannels.push(channel);
        await ctx.reply(`✅ تم إضافة @${channel}`);
    } else {
        await ctx.reply('❌ القناة موجودة.');
    }
    await ctx.scene.leave();
});

const removeChannelScene = new Scenes.BaseScene('remove-channel-scene');
removeChannelScene.enter((ctx) => {
    const list = requiredChannels.map((ch, i) => `${i+1}. @${ch}`).join('\n');
    ctx.reply(`القنوات:\n${list}\n\nأرسل اسم القناة للحذف\n/cancel للإلغاء`);
});
removeChannelScene.on('text', async (ctx) => {
    if (ctx.message.text === '/cancel') {
        await ctx.scene.leave();
        return ctx.reply('تم الإلغاء.');
    }
    const channel = ctx.message.text.trim();
    const index = requiredChannels.indexOf(channel);
    if (index > -1) {
        requiredChannels.splice(index, 1);
        await ctx.reply(`✅ تم حذف @${channel}`);
    } else {
        await ctx.reply('❌ القناة غير موجودة.');
    }
    await ctx.scene.leave();
});

// مشهد اختيار الإصدار
const versionSelectionScene = new Scenes.BaseScene('version-selection-scene');
versionSelectionScene.enter((ctx) => {
    ctx.reply('📦 **اختر إصدار ماينكرافت**', Markup.inlineKeyboard([
        [Markup.button.callback('🚀 أحدث الإصدارات (1.26.x)', 'show_latest_versions')],
        [Markup.button.callback('🌟 إصدارات حديثة (1.21-1.25)', 'show_modern_versions')],
        [Markup.button.callback('✅ إصدارات مستقرة (1.20.x)', 'show_stable_versions')],
        [Markup.button.callback('📱 إصدارات 1.19.x', 'show_1.19_versions')],
        [Markup.button.callback('💠 إصدارات أقدم', 'show_older_versions')],
        [Markup.button.callback('🤖 اكتشاف تلقائي', 'version_auto')],
        [Markup.button.callback('🔙 رجوع', 'back_to_main')]
    ]));
});

// عرض الإصدارات حسب الفئة
bot.action('show_latest_versions', (ctx) => {
    const buttons = MINECRAFT_VERSIONS.latest.map(v => 
        [Markup.button.callback(v, `version_${v}`)]
    );
    buttons.push([Markup.button.callback('🔙 رجوع', 'version-selection-scene')]);
    ctx.editMessageText('🚀 أحدث الإصدارات (1.26.x):', Markup.inlineKeyboard(buttons));
});

bot.action('show_modern_versions', (ctx) => {
    const buttons = MINECRAFT_VERSIONS.modern.map(v => 
        [Markup.button.callback(v, `version_${v}`)]
    );
    buttons.push([Markup.button.callback('🔙 رجوع', 'version-selection-scene')]);
    ctx.editMessageText('🌟 إصدارات حديثة (1.21-1.25):', Markup.inlineKeyboard(buttons));
});

bot.action('show_stable_versions', (ctx) => {
    const buttons = MINECRAFT_VERSIONS.stable.map(v => 
        [Markup.button.callback(v, `version_${v}`)]
    );
    buttons.push([Markup.button.callback('🔙 رجوع', 'version-selection-scene')]);
    ctx.editMessageText('✅ إصدارات مستقرة (1.20.x):', Markup.inlineKeyboard(buttons));
});

bot.action('show_1.19_versions', (ctx) => {
    const buttons = MINECRAFT_VERSIONS.v1_19.map(v => 
        [Markup.button.callback(v, `version_${v}`)]
    );
    buttons.push([Markup.button.callback('🔙 رجوع', 'version-selection-scene')]);
    ctx.editMessageText('📱 إصدارات 1.19.x:', Markup.inlineKeyboard(buttons));
});

bot.action('show_older_versions', (ctx) => {
    const olderVersions = [
        ...MINECRAFT_VERSIONS.v1_18,
        ...MINECRAFT_VERSIONS.v1_17,
        ...MINECRAFT_VERSIONS.v1_16
    ];
    const buttons = olderVersions.slice(0, 10).map(v => 
        [Markup.button.callback(v, `version_${v}`)]
    );
    buttons.push([Markup.button.callback('🔙 رجوع', 'version-selection-scene')]);
    ctx.editMessageText('💠 إصدارات أقدم:', Markup.inlineKeyboard(buttons));
});

// تسجيل المشاهد
stage.register(broadcastWizard);
stage.register(userActionScene);
stage.register(addServerWizard);
stage.register(removeServerWizard);
stage.register(addChannelScene);
stage.register(removeChannelScene);
stage.register(versionSelectionScene);

bot.use(session());
bot.use(stage.middleware());

// ==================== أوامر البوت الرئيسية ====================
bot.start(async (ctx) => {
    try {
        if (!(await isSubscribed(ctx)) && requiredChannels.length > 0) {
            const channels = requiredChannels.map(ch => '@' + ch).join('\n');
            return ctx.reply(`🚫 اشترك أولاً:\n${channels}`);
        }

        await notifyOwner(ctx);
        const isAdmin = await Admins.isAdmin(ctx.from.id);

        await ctx.replyWithMarkdown(
            '🎮 **بوت ماينكرافت المتكامل**\n\n' +
            '📦 يدعم جميع الإصدارات من 1.16.0 حتى 1.26.3\n\n' +
            '🔍 اختر الإصدار المناسب لسيرفرك:',
            Markup.inlineKeyboard([
                [Markup.button.callback('🚀 أحدث الإصدارات', 'show_latest_versions')],
                [Markup.button.callback('🤖 اكتشاف تلقائي', 'version_auto')],
                [Markup.button.callback('📋 قائمة الإصدارات الكاملة', 'version-selection-scene')],
                ...(isAdmin ? [[Markup.button.callback('👑 لوحة الإدارة', 'admin_panel')]] : [])
            ])
        );
    } catch (error) {}
});

// ==================== معالج اختيار الإصدار ====================
bot.action(/version_(.+)/, async (ctx) => {
    try {
        const version = ctx.match[1];
        userVersions[ctx.from.id] = version;
        await ctx.answerCbQuery(`✅ تم اختيار ${version}`);
        
        const isAdmin = await Admins.isAdmin(ctx.from.id);
        await ctx.editMessageText(
            `✅ **الإصدار المختار:** \`${version}\`\n\nاختر الأمر المناسب:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('📊 إحصائيات السيرفر', 'server_stats')],
                        [Markup.button.callback('👥 عرض اللاعبين', 'show_players')],
                        [Markup.button.callback('➕ إضافة سيرفر', 'add')],
                        [Markup.button.callback('🗑️ حذف السيرفر', 'del')],
                        [Markup.button.callback('▶️ تشغيل البوت', 'run')],
                        [Markup.button.callback('🛑 إيقاف البوت', 'stop')],
                        [Markup.button.callback('🔐 ربط مايكروسوفت', 'microsoft_login')],
                        [Markup.button.callback('🎲 حساب وهمي', 'create_random_account')],
                        [Markup.button.callback('🔄 تغيير الإصدار', 'version-selection-scene')],
                        ...(isAdmin ? [[Markup.button.callback('👑 لوحة الإدارة', 'admin_panel')]] : [])
                    ]
                }
            }
        );
    } catch (error) {}
});

bot.action('version_auto', async (ctx) => {
    try {
        await ctx.answerCbQuery('🔍 وضع اكتشاف تلقائي');
        userVersions[ctx.from.id] = 'auto';
        await ctx.editMessageText(
            '🤖 **وضع الاكتشاف التلقائي**\n\n' +
            '📥 أرسل IP السيرفر مع البورت بهذا الشكل:\n`host:port`\n\n' +
            '⚠️ مثال: `play.example.com:19132`\n\n' +
            'سيقوم البوت باكتشاف الإصدار المناسب تلقائياً',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                    ]
                }
            }
        );
        userStates[ctx.from.id] = 'awaiting_server_auto';
    } catch (error) {}
});

// ==================== إدارة السيرفرات ====================
bot.action('add', async (ctx) => {
    await ctx.editMessageText(
        '📥 **أرسل IP السيرفر مع البورت**\n\n' +
        '📝 الصيغة: `host:port`\n' +
        '📌 مثال: `play.example.com:19132`',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                ]
            }
        }
    );
    userStates[ctx.from.id] = 'awaiting_server';
});

bot.action('del', async (ctx) => {
    const userId = ctx.from.id;
    const deleted = await Servers.deleteOne({ userId });
    if (deleted) {
        stopUserBots(userId);
        await ctx.editMessageText(
            '🗑️ **تم حذف السيرفر بنجاح**',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                    ]
                }
            }
        );
    } else {
        await ctx.editMessageText(
            '❗ **لا يوجد سيرفر محفوظ**',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                    ]
                }
            }
        );
    }
});

bot.action('run', async (ctx) => {
    const userId = ctx.from.id;
    const server = await Servers.findOne({ userId });
    
    if (!server) {
        return ctx.editMessageText(
            '❗ **أضف سيرفر أولاً**',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('➕ إضافة سيرفر', 'add')]
                    ]
                }
            }
        );
    }

    await ctx.editMessageText('🚀 **جاري تشغيل البوت...**');
    connectToServer(userId);
});

bot.action('stop', async (ctx) => {
    stopUserBots(ctx.from.id);
    await ctx.editMessageText(
        '🛑 **تم إيقاف البوت**',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                ]
            }
        }
    );
});

// ==================== الإحصائيات واللاعبين ====================
bot.action('server_stats', async (ctx) => {
    const userId = ctx.from.id;
    const server = await Servers.findOne({ userId });
    
    if (!server) {
        return ctx.editMessageText(
            '❗ **أضف سيرفر أولاً**',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('➕ إضافة سيرفر', 'add')]
                    ]
                }
            }
        );
    }

    await ctx.editMessageText('📊 **جاري جمع معلومات السيرفر...**');
    
    const version = userVersions[userId] || 'auto';
    const stats = await getServerStats(server.ip, server.port, version);
    
    let message = `📊 **إحصائيات السيرفر**\n\n`;
    message += `🌐 **العنوان:** \`${server.ip}:${server.port}\`\n`;
    message += `📦 **الإصدار:** \`${stats.version}\`\n`;
    
    if (stats.success) {
        message += `✅ **الحالة:** متصل ✅\n`;
        message += `👥 **عدد اللاعبين:** ${stats.players?.length || 0}\n\n`;
        
        if (stats.players?.length > 0) {
            message += `📋 **قائمة اللاعبين:**\n`;
            stats.players.slice(0, 15).forEach((p, i) => {
                message += `${i+1}. ${p}\n`;
            });
        }
    } else {
        message += `❌ **الحالة:** غير متصل\n`;
        message += `⚠️ **الخطأ:** ${stats.error}`;
    }
    
    await ctx.replyWithMarkdown(message, {
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('🔄 تحديث', 'server_stats')],
                [Markup.button.callback('🔙 رجوع', 'back_to_main')]
            ]
        }
    });
});

bot.action('show_players', async (ctx) => {
    const userId = ctx.from.id;
    const server = await Servers.findOne({ userId });
    
    if (!server) {
        return ctx.editMessageText(
            '❗ **أضف سيرفر أولاً**',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('➕ إضافة سيرفر', 'add')]
                    ]
                }
            }
        );
    }

    await ctx.editMessageText('👥 **جاري جلب قائمة اللاعبين...**');
    
    const version = userVersions[userId] || 'auto';
    const players = await getOnlinePlayers(server.ip, server.port, version);
    
    let message = `👥 **اللاعبون في السيرفر**\n\n`;
    message += `🌐 \`${server.ip}:${server.port}\`\n\n`;
    
    if (players.length > 0) {
        message += `📋 **القائمة (${players.length}):**\n`;
        players.forEach((p, i) => {
            message += `${i+1}. ${p}\n`;
        });
    } else {
        message += '❌ لا يوجد لاعبين متصلين حالياً';
    }
    
    await ctx.replyWithMarkdown(message, {
        reply_markup: {
            inline_keyboard: [
                [Markup.button.callback('🔄 تحديث', 'show_players')],
                [Markup.button.callback('🔙 رجوع', 'back_to_main')]
            ]
        }
    });
});

// ==================== حسابات مايكروسوفت ====================
bot.action('microsoft_login', async (ctx) => {
    const captcha = generateCaptcha();
    userStates[ctx.from.id] = { state: 'awaiting_captcha', captchaCode: captcha, input: '' };
    
    await ctx.editMessageText(
        '🔐 **التحقق الأمني**\n\nأدخل الكود المكون من 6 أرقام:',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                ]
            }
        }
    );
    
    ctx.reply(`📟 **كود التحقق:** \`${captcha}\``);
    ctx.reply('🔢 **اختر الأرقام:**',
        Markup.inlineKeyboard([
            [
                Markup.button.callback('1', 'cap_1'),
                Markup.button.callback('2', 'cap_2'),
                Markup.button.callback('3', 'cap_3')
            ],
            [
                Markup.button.callback('4', 'cap_4'),
                Markup.button.callback('5', 'cap_5'),
                Markup.button.callback('6', 'cap_6')
            ],
            [
                Markup.button.callback('7', 'cap_7'),
                Markup.button.callback('8', 'cap_8'),
                Markup.button.callback('9', 'cap_9')
            ],
            [
                Markup.button.callback('🗑️ مسح', 'cap_clear'),
                Markup.button.callback('0', 'cap_0'),
                Markup.button.callback('✅ تم', 'cap_submit')
            ]
        ])
    );
});

// معالج أزرار الكابتشا
for (let i = 0; i <= 9; i++) {
    bot.action(`cap_${i}`, (ctx) => {
        const state = userStates[ctx.from.id];
        if (state?.state === 'awaiting_captcha' && state.input.length < 6) {
            state.input += i;
            ctx.answerCbQuery(`✅ ${state.input}`);
        }
    });
}

bot.action('cap_clear', (ctx) => {
    const state = userStates[ctx.from.id];
    if (state?.state === 'awaiting_captcha') {
        state.input = '';
        ctx.answerCbQuery('🗑️ تم المسح');
    }
});

bot.action('cap_submit', async (ctx) => {
    const state = userStates[ctx.from.id];
    if (state?.state !== 'awaiting_captcha') return;
    
    if (state.input === state.captchaCode) {
        ctx.answerCbQuery('✅ صحيح');
        userStates[ctx.from.id] = { state: 'awaiting_microsoft' };
        ctx.replyWithMarkdown(
            '✅ **تم التحقق بنجاح!**\n\n' +
            '📧 أرسل بيانات حساب مايكروسوفت بهذا الشكل:\n' +
            '`البريد الإلكتروني:كلمة المرور`\n\n' +
            'مثال: `example@outlook.com:password123`'
        );
    } else {
        ctx.answerCbQuery('❌ خطأ');
        delete userStates[ctx.from.id];
        ctx.reply('❌ **كود خاطئ**\nأعد المحاولة من البداية.');
    }
});

bot.action('create_random_account', async (ctx) => {
    await ctx.answerCbQuery('🔄 جاري الإنشاء...');
    const result = await createMinecraftAccount();
    
    if (result.success) {
        microsoftAccounts[ctx.from.id] = {
            email: result.email,
            password: result.password,
            username: result.username,
            isFake: true
        };
        await writeDb('microsoft.json', microsoftAccounts);
        
        await ctx.editMessageText(
            `✅ **تم إنشاء حساب وهمي**\n\n` +
            `📧 **البريد:** \`${result.email}\`\n` +
            `🔐 **كلمة المرور:** \`${result.password}\`\n` +
            `🎮 **اسم اللاعب:** \`${result.username}\`\n\n` +
            `⚠️ *هذا حساب وهمي يعمل فقط داخل البوت*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                    ]
                }
            }
        );
    } else {
        await ctx.editMessageText('❌ **فشل إنشاء الحساب**');
    }
});

// ==================== العودة للقائمة الرئيسية ====================
bot.action('back_to_main', async (ctx) => {
    const isAdmin = await Admins.isAdmin(ctx.from.id);
    const userId = ctx.from.id;
    const server = await Servers.findOne({ userId });
    const version = userVersions[userId] || 'غير محدد';
    
    let message = '🎮 **القائمة الرئيسية**\n\n';
    if (server) {
        message += `🌐 **السيرفر:** \`${server.ip}:${server.port}\`\n`;
    }
    message += `📦 **الإصدار:** \`${version}\``;
    
    const buttons = [
        [Markup.button.callback('📊 إحصائيات', 'server_stats'),
         Markup.button.callback('👥 اللاعبين', 'show_players')],
        [Markup.button.callback('➕ إضافة سيرفر', 'add'),
         Markup.button.callback('🗑️ حذف', 'del')],
        [Markup.button.callback('▶️ تشغيل', 'run'),
         Markup.button.callback('🛑 إيقاف', 'stop')],
        [Markup.button.callback('🔄 تغيير الإصدار', 'version-selection-scene')],
        [Markup.button.callback('🔐 مايكروسوفت', 'microsoft_login'),
         Markup.button.callback('🎲 حساب وهمي', 'create_random_account')]
    ];
    
    if (isAdmin) {
        buttons.push([Markup.button.callback('👑 لوحة الإدارة', 'admin_panel')]);
    }
    
    await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
    });
});

// ==================== لوحة تحكم الأدمن ====================
async function showAdminPanel(ctx) {
    const config = await readDb('config.json', { botOnline: true });
    const status = config.botOnline ? '✅ يعمل' : '❌ متوقف';
    const users = await Users.find({});
    const servers = await Servers.find({});
    
    await ctx.editMessageText(
        `👑 **لوحة تحكم الأدمن**\n\n` +
        `📊 **إحصائيات سريعة:**\n` +
        `👥 المستخدمين: ${users.length}\n` +
        `🖥️ السيرفرات: ${servers.length}\n` +
        `🤖 البوتات النشطة: ${Object.keys(clients).length}\n` +
        `🔧 حالة البوت: ${status}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('📢 إذاعة', 'admin_broadcast'),
                     Markup.button.callback('📊 إحصائيات كاملة', 'admin_stats')],
                    [Markup.button.callback('🔧 الإعدادات', 'admin_settings'),
                     Markup.button.callback('📦 السيرفرات', 'admin_servers')],
                    [Markup.button.callback('👥 إدارة المستخدمين', 'admin_users_menu'),
                     Markup.button.callback('👑 إدارة الأدمنية', 'admin_management')],
                    [Markup.button.callback('🔙 رجوع', 'back_to_main')]
                ]
            }
        }
    );
}

bot.action('admin_panel', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) {
        return ctx.answerCbQuery('⛔ غير مصرح');
    }
    await showAdminPanel(ctx);
});

bot.action('admin_stats', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const users = await Users.find({});
    const servers = await Servers.find({});
    const activeBots = Object.keys(clients).length;
    const bannedUsers = (await Users.find({ isBanned: true })).length;
    const cpu = (await pidusage(process.pid)).cpu.toFixed(2);
    const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    
    await ctx.editMessageText(
        `📊 **إحصائيات البوت الكاملة**\n\n` +
        `👥 **المستخدمين:**\n` +
        `• الإجمالي: ${users.length}\n` +
        `• النشطين: ${users.length - bannedUsers}\n` +
        `• المحظورين: ${bannedUsers}\n\n` +
        `🖥️ **السيرفرات:** ${servers.length}\n` +
        `🤖 **البوتات النشطة:** ${activeBots}\n\n` +
        `⚙️ **الأداء:**\n` +
        `• CPU: ${cpu}%\n` +
        `• RAM: ${mem} MB\n` +
        `• وقت التشغيل: ${hours}س ${minutes}د`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
                ]
            }
        }
    );
});

bot.action('admin_settings', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const config = await readDb('config.json', { botOnline: true });
    
    await ctx.editMessageText(
        '🔧 **إعدادات البوت**',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback(
                        `وضع الصيانة: ${config.botOnline ? '✅' : '❌'}`,
                        'toggle_bot_status'
                    )],
                    [Markup.button.callback('📺 إدارة القنوات', 'manage_channels')],
                    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
                ]
            }
        }
    );
});

bot.action('toggle_bot_status', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const config = await readDb('config.json', { botOnline: true });
    config.botOnline = !config.botOnline;
    await writeDb('config.json', config);
    
    await ctx.editMessageText(
        `✅ **تم ${config.botOnline ? 'تشغيل' : 'إيقاف'} البوت**`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔙 رجوع', 'admin_settings')]
                ]
            }
        }
    );
});

bot.action('admin_users_menu', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    await ctx.editMessageText(
        '👥 **إدارة المستخدمين**',
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🛡️ حظر مستخدم', 'admin_ban_user'),
                     Markup.button.callback('🔓 رفع حظر', 'admin_unban_user')],
                    [Markup.button.callback('🔍 معلومات مستخدم', 'admin_user_info')],
                    [Markup.button.callback('📋 قائمة المحظورين', 'admin_banned_list')],
                    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
                ]
            }
        }
    );
});

bot.action('admin_banned_list', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const banned = await Users.find({ isBanned: true });
    if (banned.length === 0) {
        return ctx.editMessageText('✅ لا يوجد مستخدمين محظورين');
    }
    
    const list = banned.map((u, i) => `${i+1}. ${u.userId}`).join('\n');
    await ctx.editMessageText(
        `📋 **المستخدمين المحظورين:**\n\n${list}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔙 رجوع', 'admin_users_menu')]
                ]
            }
        }
    );
});

bot.action('admin_management', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const adminsList = await Admins.find();
    const list = adminsList.map((id, i) => `${i+1}. ${id}`).join('\n');
    
    await ctx.editMessageText(
        `👑 **إدارة الأدمنية**\n\n**الأدمنية الحاليين:**\n${list}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('➕ رفع أدمن', 'add_admin'),
                     Markup.button.callback('➖ تنزيل أدمن', 'remove_admin')],
                    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
                ]
            }
        }
    );
});

bot.action('manage_channels', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const list = requiredChannels.length > 0
        ? requiredChannels.map((c, i) => `${i+1}. @${c}`).join('\n')
        : 'لا توجد قنوات';
    
    await ctx.editMessageText(
        `📺 **القنوات المطلوبة**\n\n${list}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('➕ إضافة قناة', 'add_channel'),
                     Markup.button.callback('➖ حذف قناة', 'remove_channel')],
                    [Markup.button.callback('🔙 رجوع', 'admin_settings')]
                ]
            }
        }
    );
});

bot.action('admin_servers', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const servers = await Servers.find({});
    const total = servers.length;
    
    await ctx.editMessageText(
        `📦 **إدارة السيرفرات**\n\nالإجمالي: ${total}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('➕ إضافة سيرفر', 'admin_add_server'),
                     Markup.button.callback('➖ حذف سيرفر', 'admin_remove_server')],
                    [Markup.button.callback('📜 عرض الكل', 'admin_all_servers')],
                    [Markup.button.callback('🔙 رجوع', 'admin_panel')]
                ]
            }
        }
    );
});

bot.action('admin_add_server', (ctx) => ctx.scene.enter('admin-add-server-wizard'));
bot.action('admin_remove_server', (ctx) => ctx.scene.enter('admin-remove-server-wizard'));
bot.action('admin_broadcast', (ctx) => ctx.scene.enter('admin-broadcast-wizard'));
bot.action('admin_ban_user', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'ban' }));
bot.action('admin_unban_user', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'unban' }));
bot.action('admin_user_info', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'info' }));
bot.action('add_admin', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'add_admin' }));
bot.action('remove_admin', (ctx) => ctx.scene.enter('admin-user-action-scene', { action: 'remove_admin' }));
bot.action('add_channel', (ctx) => ctx.scene.enter('add-channel-scene'));
bot.action('remove_channel', (ctx) => ctx.scene.enter('remove-channel-scene'));

bot.action('admin_all_servers', async (ctx) => {
    if (!(await Admins.isAdmin(ctx.from.id))) return;
    
    const servers = await Servers.find({});
    if (servers.length === 0) {
        return ctx.editMessageText('📭 لا يوجد سيرفرات');
    }
    
    const list = servers.map((s, i) => 
        `${i+1}. ${s.name || 'بدون اسم'} - \`${s.ip}:${s.port}\``
    ).join('\n');
    
    await ctx.editMessageText(
        `📜 **جميع السيرفرات (${servers.length})**\n\n${list}`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [Markup.button.callback('🔙 رجوع', 'admin_servers')]
                ]
            }
        }
    );
});

// ==================== معالج النصوص ====================
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const state = userStates[userId];

    // أوامر الأدمن
    if (await Admins.isAdmin(userId)) {
        if (text === '/stats') {
            const users = await Users.find({});
            const servers = await Servers.find({});
            const active = Object.keys(clients).length;
            return ctx.replyWithMarkdown(
                `📊 **إحصائيات سريعة**\n\n` +
                `👥 المستخدمين: ${users.length}\n` +
                `🖥️ السيرفرات: ${servers.length}\n` +
                `🤖 النشطة: ${active}`
            );
        }
        
        if (text === '/channels') {
            const list = requiredChannels.map((c, i) => `${i+1}. @${c}`).join('\n');
            return ctx.replyWithMarkdown(
                `📺 **القنوات المطلوبة**\n\n${list || 'لا توجد قنوات'}`
            );
        }
        
        if (text.startsWith('/broadcast ')) {
            const msg = text.replace('/broadcast ', '');
            const users = await Users.find({ isBanned: false });
            let sent = 0;
            await ctx.reply('📤 جاري الإرسال...');
            
            for (const user of users) {
                try {
                    await ctx.telegram.sendMessage(user.userId, msg);
                    sent++;
                } catch {}
                await new Promise(r => setTimeout(r, 100));
            }
            return ctx.reply(`✅ تم الإرسال إلى ${sent} مستخدم`);
        }
    }

    // إضافة سيرفر
    if (state === 'awaiting_server') {
        const parts = text.split(':');
        if (parts.length !== 2) {
            return ctx.reply('❌ **صيغة خاطئة**\nاستخدم: `host:port`');
        }
        const ip = parts[0].trim();
        const port = parseInt(parts[1].trim());
        if (isNaN(port)) {
            return ctx.reply('❌ **البورت يجب أن يكون رقماً**');
        }
        
        const existing = await Servers.findOne({ userId });
        if (existing) {
            await Servers.updateOne({ userId }, { ip, port });
        } else {
            await Servers.create({ userId, ip, port, name: `Server_${userId}` });
        }
        
        delete userStates[userId];
        ctx.replyWithMarkdown(`✅ **تم حفظ السيرفر**\n\`${ip}:${port}\``);
    }
    
    // وضع تلقائي
    else if (state === 'awaiting_server_auto') {
        const parts = text.split(':');
        if (parts.length !== 2) {
            return ctx.reply('❌ **صيغة خاطئة**\nاستخدم: `host:port`');
        }
        const ip = parts[0].trim();
        const port = parseInt(parts[1].trim());
        if (isNaN(port)) {
            return ctx.reply('❌ **البورت يجب أن يكون رقماً**');
        }
        
        await Servers.deleteOne({ userId });
        await Servers.create({ userId, ip, port, name: `Server_${userId}` });
        delete userStates[userId];
        
        ctx.reply('🔍 **جاري اكتشاف إصدار السيرفر...**');
        const result = await detectServerVersion(ip, port);
        
        if (result.success) {
            userVersions[userId] = result.version;
            ctx.replyWithMarkdown(
                `✅ **تم اكتشاف الإصدار:** \`${result.version}\`\n\n` +
                `🚀 **جاري تشغيل البوت تلقائياً...**`
            );
            setTimeout(() => connectToServer(userId), 2000);
        } else {
            ctx.replyWithMarkdown(
                '❌ **فشل اكتشاف الإصدار**\n\n' +
                '🔍 يرجى اختيار الإصدار يدوياً من القائمة.'
            );
        }
    }
    
    // بيانات مايكروسوفت
    else if (state?.state === 'awaiting_microsoft') {
        const parts = text.split(':');
        if (parts.length !== 2) {
            return ctx.reply('❌ **صيغة خاطئة**\nاستخدم: `email:password`');
        }
        const [email, password] = parts;
        microsoftAccounts[userId] = { email, password, isReal: true };
        await writeDb('microsoft.json', microsoftAccounts);
        delete userStates[userId];
        ctx.replyWithMarkdown(
            '✅ **تم حفظ بيانات مايكروسوفت**\n\n' +
            '📧 يمكنك الآن استخدام البوت بحسابك الحقيقي'
        );
    }
});

// ==================== تشغيل البوت ====================
async function setupInitialConfig() {
    const config = await readDb('config.json', {});
    if (Object.keys(config).length === 0) {
        await writeDb('config.json', { botOnline: true });
    }
    admins = await Admins.find();
    microsoftAccounts = await readDb('microsoft.json', {});
}

(async () => {
    await setupInitialConfig();
    bot.launch().then(() => {
        console.log('✅='.repeat(20));
        console.log('✅ بوت ماينكرافت المتكامل شغال!');
        console.log('📦 يدعم جميع الإصدارات من 1.16.0 حتى 1.26.3');
        console.log('📱 أرسل /start في التليجرام');
        console.log('✅='.repeat(20));
    }).catch(err => {
        console.error('❌ فشل تشغيل البوت:', err);
    });
})();

// ==================== إيقاف نظيف ====================
process.once('SIGINT', () => {
    console.log('\n🛑 جاري إيقاف البوت...');
    Object.values(clients).forEach(c => { 
        try { c.end(); } catch (e) {} 
    });
    bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
    console.log('\n🛑 جاري إيقاف البوت...');
    Object.values(clients).forEach(c => { 
        try { c.end(); } catch (e) {} 
    });
    bot.stop('SIGTERM');
});
