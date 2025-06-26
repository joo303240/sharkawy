
const express = require("express");
const app = express();
const { Boom } = require('@hapi/boom');
const { 
    useMultiFileAuthState, 
    makeWASocket, 
    DisconnectReason,
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const ytdlp = require('yt-dlp-exec').default;
const path = require("path");
const ytPath = path.join(__dirname, "yt-dlp");

const ytdlpExec = ytdlp.create({
  binary: ytPath
});

const execPromise = promisify(exec);

// إعدادات المحاكاة لمتصفح Chrome
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// إنشاء مجلد التحميلات إذا لم يكن موجوداً
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// دوال التحميل
// دوال التحميل
async function downloadVideo(url, platform) {
    try {
        // إنشاء اسم ملف فريد
        const timestamp = Date.now();
        const filename = `${platform}_${timestamp}.%(ext)s`;
        const outputPath = path.join(DOWNLOADS_DIR, filename);

        console.log(`🎬 جاري تحميل من ${platform}...`);

        // خيارات yt-dlp المحسنة
        const ytdlpOptions = {
            noWarnings: true,
            noCheckCertificate: true,
            preferFfmpeg: true,
            mergeOutputFormat: 'mp4',
            format: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best[height<=480]/best',
            maxFilesize: '250M',
            output: outputPath,
            userAgent: CHROME_USER_AGENT
        };

        // تنفيذ التحميل باستخدام مكتبة yt-dlp-exec
        await ytdlp(url, ytdlpOptions);

        // البحث عن الملف المحمل
        const files = fs.readdirSync(DOWNLOADS_DIR);
        const downloadedFile = files.find(file =>
            file.includes(platform) &&
            file.includes(timestamp.toString()) &&
            (file.endsWith('.mp4') || file.endsWith('.mkv') || file.endsWith('.webm'))
        );

        if (!downloadedFile) {
            throw new Error('لم يتم العثور على الملف المحمل');
        }

        const filepath = path.join(DOWNLOADS_DIR, downloadedFile);

        // الحصول على معلومات الفيديو
        let title = 'فيديو محمل';
        try {
            const info = await ytdlp(url, { getTitle: true, noWarnings: true });
            if (typeof info === 'string') {
                title = info.trim().substring(0, 50) || title;
            }
        } catch (titleError) {
            console.log('⚠️ لم يتم الحصول على العنوان:', titleError.message);
        }

        console.log('✅ تم تحميل الفيديو بنجاح');
        return { filepath, title, platform };

    } catch (error) {
        console.error('❌ خطأ في التحميل:', error.message);

        // رسائل خطأ محسنة
        if (error.message.includes('timeout')) {
            throw new Error('انتهت مهلة التحميل. الفيديو قد يكون كبيراً جداً أو الاتصال بطيء');
        } else if (error.message.includes('404') || error.message.includes('Not Found')) {
            throw new Error('الفيديو غير موجود أو محذوف');
        } else if (error.message.includes('Private')) {
            throw new Error('الفيديو خاص ولا يمكن تحميله');
        } else if (error.message.includes('age')) {
            throw new Error('الفيديو مقيد بالعمر ولا يمكن تحميله');
        } else if (error.message.includes('geo')) {
            throw new Error('الفيديو غير متاح في منطقتك الجغرافية');
        } else {
            throw new Error(`فشل في تحميل فيديو ${platform}: ${error.message}`);
        }
    }
}

async function downloadFromYouTube(url) {
    return await downloadVideo(url, 'YouTube');
}

async function downloadFromTikTok(url) {
    return await downloadVideo(url, 'TikTok');
}

async function downloadFromFacebook(url) {
    return await downloadVideo(url, 'Facebook');
}

async function downloadFromInstagram(url) {
    return await downloadVideo(url, 'Instagram');
}

function detectPlatform(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return 'YouTube';
    } else if (url.includes('tiktok.com')) {
        return 'TikTok';
    } else if (url.includes('facebook.com') || url.includes('fb.watch')) {
        return 'Facebook';
    } else if (url.includes('instagram.com')) {
        return 'Instagram';
    }
    return null;
}

async function processDownload(url) {
    const platform = detectPlatform(url);

    if (!platform) {
        throw new Error('منصة غير مدعومة. المنصات المدعومة: YouTube, TikTok, Facebook, Instagram');
    }

    switch (platform) {
        case 'YouTube':
            return await downloadFromYouTube(url);
        case 'TikTok':
            return await downloadFromTikTok(url);
        case 'Facebook':
            return await downloadFromFacebook(url);
        case 'Instagram':
            return await downloadFromInstagram(url);
        default:
            throw new Error('منصة غير مدعومة');
    }
}

// جلب معلومات الفيديو باستخدام yt-dlp-exec
async function getVideoInfo(url) {
    try {
        const info = await ytdlp(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCheckCertificate: true,
            userAgent: CHROME_USER_AGENT
        });
        return info;
    } catch (error) {
        throw new Error('تعذر جلب معلومات الفيديو: ' + error.message);
    }
}

async function startBot() {
    try {
        // الحصول على أحدث إصدار من Baileys
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`استخدام إصدار واتساب: ${version.join('.')}, هل هو الأحدث: ${isLatest}`);

        // تهيئة حالة المصادقة متعددة الملفات
        const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

        // إنشاء سوكيت واتساب
        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }), // إيقاف التسجيل للحصول على مخرجات نظيفة
            printQRInTerminal: true,
            auth: state,
            browser: ['Chrome (Windows)', 'Desktop', '120.0.0.0'], // محاكاة Chrome
            defaultQueryTimeoutMs: 60000, // مهلة زمنية للاستعلامات
            keepAliveIntervalMs: 10000, // فترة البقاء متصل
            markOnlineOnConnect: true, // وضع علامة متصل عند الاتصال
            syncFullHistory: false, // عدم مزامنة التاريخ الكامل لتوفير الوقت
            getMessage: async (key) => {
                // إرجاع null للرسائل المفقودة
                return null;
            }
        });

        // معالجة تحديثات الاتصال
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // عرض QR كود في الطرفية
                console.log('\n🔍 يرجى مسح QR كود للاتصال بواتساب:\n');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error instanceof Boom && 
                    lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut;

                console.log('❌ انقطع الاتصال بسبب:', lastDisconnect?.error?.message || 'سبب غير معروف');

                if (shouldReconnect) {
                    console.log('🔄 جاري إعادة الاتصال...');
                    setTimeout(() => startBot(), 5000); // إعادة الاتصال بعد 5 ثوانٍ
                } else {
                    console.log('🚪 تم تسجيل الخروج من واتساب');
                }
            } else if (connection === 'open') {
                console.log('✅ تم الاتصال بنجاح بواتساب!');
                console.log('📱 البوت جاهز لاستقبال الرسائل...');
            } else if (connection === 'connecting') {
                console.log('🔗 جاري الاتصال بواتساب...');
            }
        });

        // حفظ بيانات الاعتماد عند التحديث
        sock.ev.on('creds.update', saveCreds);

        // معالجة الرسائل الواردة
        sock.ev.on('messages.upsert', async (messageUpdate) => {
            try {
                const messages = messageUpdate.messages;

                for (const message of messages) {
                    // تجاهل الرسائل المرسلة من البوت نفسه
                    if (message.key.fromMe) continue;

                    // التأكد من أن الرسالة جديدة وليست من التاريخ
                    if (messageUpdate.type !== 'notify') continue;

                    // استخراج نص الرسالة
                    const messageText = message.message?.conversation || 
                                      message.message?.extendedTextMessage?.text || '';

                    console.log(`📩 رسالة واردة من ${message.key.remoteJid}: ${messageText}`);

                    // الرد على السلام
                    const greetings = ['السلام', 'سلام', 'السلام عليكم', 'سلام عليكم'];
                    const isGreeting = greetings.some(greeting => 
                        messageText.toLowerCase().includes(greeting.toLowerCase())
                    );

                    if (isGreeting) {
                        await sock.sendMessage(message.key.remoteJid, {
                            text: 'وعليكم السلام ورحمة الله وبركاته 🌹\nأهلاً وسهلاً بك!\n\n📋 الأوامر المتاحة:\n• !تحميل [رابط] - لتحميل فيديو\n• !مساعدة - لعرض المساعدة\n• !معلومات - معلومات البوت'
                        });
                        console.log('✅ تم الرد على السلام');
                        continue;
                    }

                    // معالجة الأوامر
                    if (messageText.startsWith('!')) {
                        const command = messageText.split(' ')[0].toLowerCase();
                        const args = messageText.split(' ').slice(1);

                        switch (command) {
                            case '!تحميل':
                            case '!download':
                                if (args.length === 0) {
                                    await sock.sendMessage(message.key.remoteJid, {
                                        text: '❌ يرجى إدخال رابط الفيديو\n\nمثال: !تحميل https://youtube.com/watch?v=...'
                                    });
                                    break;
                                }

                                const url = args[0];
                                const platform = detectPlatform(url);

                                if (!platform) {
                                    await sock.sendMessage(message.key.remoteJid, {
                                        text: '❌ رابط غير مدعوم\n\n📱 المنصات المدعومة:\n• YouTube\n• TikTok\n• Facebook\n• Instagram'
                                    });
                                    break;
                                }

                                // إرسال رسالة تأكيد بدء التحميل
                                await sock.sendMessage(message.key.remoteJid, {
                                    text: `🔄 جاري تحميل الفيديو من ${platform}...\nقد يستغرق الأمر بضع دقائق حسب حجم الفيديو.\n\n⏱️ الرجاء الانتظار...`
                                });

                                let result = null;
                                let stats = null;
                                let fileSizeInMB = 0;
                                let videoBuffer = null;
                                try {
                                    result = await processDownload(url);
                                    stats = fs.statSync(result.filepath);
                                    fileSizeInMB = stats.size / (1024 * 1024);

                                    if (fileSizeInMB > 250) {
                                        await sock.sendMessage(message.key.remoteJid, {
                                            text: `❌ حجم الفيديو كبير جداً (${fileSizeInMB.toFixed(2)} ميجا)\nالحد الأقصى المسموح: 250 ميجا`
                                        });
                                        // حذف الملف الكبير
                                        fs.unlinkSync(result.filepath);
                                        break;
                                    }

                                    // إرسال الفيديو
                                    videoBuffer = fs.readFileSync(result.filepath);
                                    await sock.sendMessage(message.key.remoteJid, {
                                        video: videoBuffer,
                                        caption: `✅ تم تحميل الفيديو بنجاح!\n\n📱 المنصة: ${result.platform}\n📹 العنوان: ${result.title}\n📦 الحجم: ${fileSizeInMB.toFixed(2)} ميجا`,
                                        mimetype: 'video/mp4'
                                    });
                                    console.log('✅ تم إرسال الفيديو بنجاح');
                                } catch (error) {
                                    console.error('❌ خطأ في التحميل:', error.message);
                                    await sock.sendMessage(message.key.remoteJid, {
                                        text: `❌ فشل في تحميل الفيديو\n\nالخطأ: ${error.message}\n\n💡 تأكد من صحة الرابط وأن الفيديو متاح للتحميل`
                                    });
                                } finally {
                                    // حذف الملف بعد الإرسال أو الخطأ
                                    try {
                                        if (result && result.filepath && fs.existsSync(result.filepath)) {
                                            fs.unlinkSync(result.filepath);
                                        }
                                    } catch (delErr) {
                                        console.error('⚠️ فشل حذف الملف المؤقت:', delErr.message);
                                    }
                                }
                                break;

                            case '!مساعدة':
                            case '!help':
                                await sock.sendMessage(message.key.remoteJid, {
                                    text: `🤖 مساعدة بوت التحميل\n\n📋 الأوامر المتاحة:\n!معلومات_فيديو [رابط] \n لعرض معلومات الفيديو \n• !تحميل [رابط]\n  لتحميل فيديو من المنصات المدعومة\n\n• !معلومات\n  معلومات عن البوت من المنصات المدعومة\n\n• !مساعدة\n  عرض هذه الرسالة\n\n📱 المنصات المدعومة:\n• YouTube (يوتيوب)\n• TikTok (تيك توك)\n• Facebook (فيسبوك)\n• Instagram (انستغرام)\n\n📝 مثال على الاستخدام:\n!تحميل https://youtube.com/watch?v=dQw4w9WgXcQ`
                                });
                                break;

                            case '!معلومات':
                            case '!info':
                                await sock.sendMessage(message.key.remoteJid, {
                                    text: `ℹ️ معلومات البوت\n\n🤖 اسم البوت: بوت التحميل\n📱 الإصدار: 2.1\n🔧 المطور: Assistant\n📦 المكتبة: Baileys 6.5.0\n\n🌟 الميزات:\n• تحميل فيديوهات عالية الجودة حتى 720p\n• دعم متعدد المنصات\n• واجهة سهلة الاستخدام\n• آمن ومستقر\n\n⚠️ ملاحظات:\n• الحد الأقصى لحجم الفيديو: 250 ميجا\n• يتم حذف الفيديوهات بعد الإرسال تلقائياً\n• احترم حقوق الطبع والنشر`
                                });
                                break;

                            case '!معلومات_فيديو':
                            case '!videoinfo':
                                if (args.length === 0) {
                                    await sock.sendMessage(message.key.remoteJid, {
                                        text: '❌ يرجى إدخال رابط الفيديو\n\nمثال: !معلومات_فيديو https://youtube.com/watch?v=...'
                                    });
                                    break;
                                }
                                const infoUrl = args[0];
                                await sock.sendMessage(message.key.remoteJid, { text: '🔎 جاري جلب معلومات الفيديو...' });
                                try {
                                    const info = await getVideoInfo(infoUrl);
                                    // ترتيب وعرض المعلومات
                                    let msg = `📊 *معلومات الفيديو:*
`;
                                    msg += `*العنوان:* ${info.title || '-'}\n`;
                                    msg += `*الرابط:* ${info.webpage_url || infoUrl}\n`;
                                    msg += `*القناة/المالك:* ${info.channel || info.uploader || '-'}\n`;
                                    msg += `*عدد المشاهدات:* ${info.view_count?.toLocaleString() || '-'}\n`;
                                    msg += `*عدد اللايكات:* ${info.like_count?.toLocaleString() || '-'}\n`;
                                    msg += `*عدد التعليقات:* ${info.comment_count?.toLocaleString() || '-'}\n`;
                                    msg += `*المدة:* ${info.duration ? (Math.floor(info.duration/60)+':' + String(info.duration%60).padStart(2,'0')) : '-'} دقيقة\n`;
                                    msg += `*تاريخ النشر:* ${info.upload_date ? info.upload_date.replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1') : '-'}\n`;
                                    msg += `*الوصف:*\n${info.description ? info.description.substring(0, 500) : '-'}\n`;
                                    await sock.sendMessage(message.key.remoteJid, { text: msg });
                                } catch (err) {
                                    await sock.sendMessage(message.key.remoteJid, { text: '❌ تعذر جلب معلومات الفيديو\n' + err.message });
                                }
                                break;

                            default:
                                await sock.sendMessage(message.key.remoteJid, {
                                    text: '❌ أمر غير معروف\n\nاستخدم !مساعدة لعرض الأوامر المتاحة'
                                });
                                break;
                        }
                    }
                }
            } catch (error) {
                console.error('❌ خطأ في معالجة الرسالة:', error.message);
            }
        });

        // معالجة الأخطاء العامة
        sock.ev.on('CB:call', (data) => {
            console.log('📞 مكالمة واردة:', data);
        });

        // معالجة تحديثات الحضور
        sock.ev.on('presence.update', (data) => {
            // يمكن إزالة هذا إذا لم تكن تريد رؤية تحديثات الحضور
            // console.log('👁️ تحديث حضور:', data);
        });

        return sock;

    } catch (error) {
        console.error('❌ خطأ في بدء تشغيل البوت:', error.message);

        // إعادة المحاولة بعد 10 ثوانٍ في حالة الخطأ
        setTimeout(() => {
            console.log('🔄 إعادة محاولة بدء تشغيل البوت...');
            startBot();
        }, 10000);
    }
}

// معالجة إنهاء البرنامج بشكل صحيح
process.on('SIGINT', () => {
    console.log('\n👋 إيقاف البوت...');
    process.exit(0);
});

// تعزيز الاستقرار: إعادة المحاولة عند أي خطأ غير متوقع في الأحداث الأساسية
process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error.message);
    setTimeout(() => startBot(), 5000);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ رفض غير معالج:', reason);
    setTimeout(() => startBot(), 5000);
});

// بدء تشغيل البوت
console.log('🚀 بدء تشغيل بوت واتساب...');
startBot().catch(err => {
    console.error('❌ فشل في بدء تشغيل البوت:', err.message);
    process.exit(1);
});
// سيرفر صغير لإبقاء البوت حي


app.get("/", (req, res) => {
  res.send("✅ WhatsApp Bot is alive and running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 HTTP Server running on port ${PORT}`);
});

