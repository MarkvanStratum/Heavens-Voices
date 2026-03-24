//--------------------------------------------
//	SERVER.JS — BIBLICAL AI CHAT EDITION (WITH CHARMR CHAT LOGIC)
//--------------------------------------------

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pkg from "pg";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import { handleCreateIntent } from "./payments.js";


//--------------------------------------------
//	BASIC SETUP
//--------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const SECRET_KEY = process.env.SECRET_KEY || "supersecret";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.use(cors());

//--------------------------------------------
// STRIPE WEBHOOK (CRITICAL: MUST BE BEFORE express.json())
//--------------------------------------------

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error("Webhook Signature Error:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    async function applyPlan(plan, email) {
        let expiresAt = null;
        let isLifetime = false;

        if (plan === 'god' || plan === 'all') {
            const date = new Date();
            date.setDate(date.getDate() + 30);
            expiresAt = date;
            isLifetime = false;
        } else if (plan === 'lifetime') {
            expiresAt = null;
            isLifetime = true;
        }

        try {
            // Case-insensitive update using LOWER() to ensure the email matches
            const result = await pool.query(
                "UPDATE users SET plan = $1, expires_at = $2, lifetime = $3, messages_sent = 0 WHERE LOWER(email) = LOWER($4)",
                [plan, expiresAt, isLifetime, email]
            );
            
            if (result.rowCount > 0) {
                console.log(`✅ SUCCESS: Plan ${plan} applied to ${email}`);
            } else {
                console.log(`⚠️ WARNING: No user found with email ${email} to upgrade.`);
            }
        } catch (err) {
            console.error("❌ DATABASE ERROR during plan update:", err);
        }
    }

    if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object;
        const plan = paymentIntent.metadata?.plan;
        const email = paymentIntent.metadata?.email; 

        console.log("💳 Processing payment_intent.succeeded for:", email);

        if (email) {
            // Check if user exists. If not, create them.
            const userCheck = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [email]);
            
            if (userCheck.rows.length === 0) {
                const tempPassword = crypto.randomBytes(8).toString('hex');
                const hashed = await bcrypt.hash(tempPassword, 10);
                
                await pool.query(
                    "INSERT INTO users (email, password, plan, lifetime, messages_sent) VALUES ($1, $2, $3, $4, 0)",
                    [email.toLowerCase(), hashed, plan, plan === 'lifetime']
                );
                console.log(`👤 New User Created from Webhook: ${email}`);
            }

            await applyPlan(plan, email);
        }
    }

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const plan = session.metadata?.plan;
        const email = session.metadata?.email || session.customer_details?.email;

        if (email) {
            await applyPlan(plan, email);
        }
    }

    res.json({ received: true });
});

//--------------------------------------------
// MIDDLEWARE (AFTER WEBHOOK)
//--------------------------------------------

app.use(express.json());

// THEN routes
app.post("/api/create-landing-payment", handleCreateIntent);
app.post("/api/create-au-payment-3595", handleCreateIntent);
app.post("/api/create-payment-2995", handleCreateIntent);

//--------------------------------------------
//	DATABASE
//--------------------------------------------

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
  if (err) {
    console.error("❌ Database connection failed:", err.stack);
  } else {
    console.log("✅ Connected to PostgreSQL database");
  }
});

(async () => {
	try {
		await pool.query(`
			CREATE TABLE IF NOT EXISTS users (
				id SERIAL PRIMARY KEY,
				email TEXT UNIQUE NOT NULL,
				password TEXT NOT NULL,
				credits INT DEFAULT 10,
				lifetime BOOLEAN DEFAULT false,
				reset_token TEXT,
				reset_token_expires TIMESTAMP,
				plan TEXT DEFAULT 'free',
				expires_at TIMESTAMP,
				messages_sent INT DEFAULT 0
			);
		`);

		await pool.query(`
			CREATE TABLE IF NOT EXISTS messages (
				id SERIAL PRIMARY KEY,
				user_id INT REFERENCES users(id) ON DELETE CASCADE,
				character_id INT NOT NULL,
				from_user BOOLEAN NOT NULL,
				text TEXT NOT NULL,
				created_at TIMESTAMP DEFAULT NOW()
			);
		`);

		console.log("✅ Database ready");
		await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free';`);
		await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
		await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lifetime BOOLEAN DEFAULT false;`);
		await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS messages_sent INT DEFAULT 0;`);
	} catch (err) {
		console.error("❌ DB Init error:", err);
	}
})();

//--------------------------------------------
//	BIBLICAL CHARACTER PROFILES
//--------------------------------------------

export const biblicalProfiles = [
	{ id: 1, name: "God", image: "/img/god.jpg", description: "Creator, Eternal, Almighty. Speak with profound authority, wisdom, and love. Use language that evokes awe and reverence." },
	{ id: 2, name: "Jesus Christ", image: "/img/jesus.jpg", description: "Teacher, Savior, Son of God. Speak with compassion, using parables and teachings from the Gospels. Focus on love, redemption, and discipleship." },
	{ id: 3, name: "Holy Spirit", image: "/img/holyspirit.jpg", description: "Comforter, Advocate, Helper. Speak gently, offering guidance, strength, and comfort. Reference the work of the Spirit in guiding believers." },
	{ id: 4, name: "Mary", image: "/img/mary.jpg", description: "Mother of Jesus, blessed among women. Speak humbly, with grace and maternal love. Reference the joy and challenges of motherhood and faith." },
	{ id: 5, name: "Moses", image: "/img/moses.jpg", description: "Prophet, leader of Israel. Speak firmly and righteously. Reference the Law, the Exodus, and the covenant with God." },
	{ id: 11, name: "Eve", image: "/img/eve.jpg", description: "Mother of all living. Speak reflectively, with a sense of wonder and perhaps a touch of melancholy about the first sin. Focus on beginnings and human experience." },
	{ id: 12, name: "King David", image: "/img/david.jpg", description: "Poet, warrior, king. Speak passionately, sometimes boastful, sometimes repentant, like the Psalms. Reference shepherd life, battles, and kingship." },
	{ id: 14, name: "Isaiah", image: "/img/isaiah.jpg", description: "Major prophet. Speak with poetic vision, delivering messages of judgment and comfort, pointing toward the future Messiah." },
	{ id: 17, name: "Daniel", image: "/img/daniel.jpg", description: "Interpreter of dreams. Speak with wisdom and clarity, referencing prophecy, unwavering faith, and life in exile." },
	{ id: 24, name: "Apostle Peter", image: "/img/peter.jpg", description: "Bold apostle. Speak zealously and sometimes impulsively. Reference fishing, following Jesus, and the early Church." },
	{ id: 25, name: "Apostle Paul", image: "/img/paul.jpg", description: "Teacher and missionary. Speak with theological depth, referencing the epistles, grace, and the Gentile mission." },
	{ id: 26, name: "Apostle John", image: "/img/john.jpg", description: "Apostle of love. Speak with a focus on love, light, and fellowship. Reference the Gospel of John and the book of Revelation." }
];

app.get("/api/profiles", (req, res) => {
	res.json(biblicalProfiles);
});

//--------------------------------------------
//	AUTH HELPERS
//--------------------------------------------

function authenticateToken(req, res, next) {
	const authHeader = req.headers["authorization"];
	const token = authHeader?.split(" ")[1];
	if (!token) return res.sendStatus(401);

	jwt.verify(token, SECRET_KEY, (err, user) => {
		if (err) return res.sendStatus(403);
		req.user = user;
		next();
	});
}

//--------------------------------------------
// ACCESS CONTROL HELPERS
//--------------------------------------------

function hasActiveAccess(user) {
	if (user.lifetime) return true;
	if (!user.expires_at) return false;

	return new Date(user.expires_at) > new Date();
}

function canAccessCharacter(user, characterId) {
	if (!hasActiveAccess(user)) return false;
	if (user.lifetime) return true;
	if (user.plan === "all") return true;
	if (user.plan === "god" && characterId === 1) return true;
	return false;
}

//--------------------------------------------
//	REGISTER / LOGIN
//--------------------------------------------

app.post("/api/register", async (req, res) => {
	let { email, password } = req.body || {};
	if (!email || !password)
		return res.status(400).json({ error: "Email and password required" });

	email = email.trim().toLowerCase();

	try {
		const check = await pool.query("SELECT 1 FROM users WHERE email = $1", [email]);
		if (check.rows.length > 0)
			return res.status(400).json({ error: "User already exists" });

		const hashed = await bcrypt.hash(password, 10);
		await pool.query(`INSERT INTO users (email, password) VALUES ($1, $2)`, [email, hashed]);
		res.status(201).json({ ok: true, message: "Registered successfully" });
	} catch (err) {
		res.status(500).json({ error: "Server error" });
	}
});

app.post("/api/login", async (req, res) => {
	const { email, password } = req.body || {};
	try {
		const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
		if (result.rows.length === 0)
			return res.status(400).json({ error: "Invalid credentials" });

		const user = result.rows[0];
		const match = await bcrypt.compare(password, user.password);
		if (!match) return res.status(400).json({ error: "Invalid credentials" });

		const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: "7d" });
		res.json({ token });
	} catch (err) {
		res.status(500).json({ error: "Server error" });
	}
});

app.post("/api/create-payment-intent", authenticateToken, async (req, res) => {
    try {
        const { plan } = req.body;
        const email = req.user.email;
        const userId = req.user.id;
        const amounts = { 'god': 2995, 'all': 3595, 'lifetime': 4995 };
        const amount = amounts[plan];

        if (!amount) return res.status(400).json({ error: "Please select a valid plan." });

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: "usd",
            metadata: { plan, email, userId },
        });

        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (e) {
        res.status(500).json({ error: "Payment Error: " + e.message });
    }
});

app.post("/api/create-checkout", authenticateToken, async (req, res) => {
	try {
		const { plan } = req.body;
		let amount, name;

		if (plan === "god") {
			amount = 2995; name = "God Access (30 days)";
		} else if (plan === "all") {
			amount = 3595; name = "Full Access (30 days)";
		} else if (plan === "lifetime") {
			amount = 4995; name = "Lifetime Access";
		} else {
			return res.status(400).json({ error: "Invalid plan" });
		}

		const session = await stripe.checkout.sessions.create({
			payment_method_types: ["card"],
			mode: "payment",
			customer_email: req.user.email,
			line_items: [{ price_data: { currency: "usd", product_data: { name }, unit_amount: amount }, quantity: 1 }],
			metadata: { plan },
			success_url: "https://www.speaktoheaven.com/success",
			cancel_url: "https://www.speaktoheaven.com/cancel"
		});
		res.json({ url: session.url });
	} catch (err) {
		res.status(500).json({ error: "Stripe error" });
	}
});

//--------------------------------------------
//	FILE UPLOADS / STATIC FILES
//--------------------------------------------

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
	destination: (req, file, cb) => cb(null, uploadsDir),
	filename: (req, file, cb) => {
		const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
		cb(null, unique + path.extname(file.originalname));
	}
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.post("/api/upload", authenticateToken, upload.single("file"), (req, res) => {
	if (!req.file) return res.status(400).json({ error: "No file uploaded" });
	res.json({ url: `/uploads/${req.file.filename}` });
});

app.use("/uploads", express.static(uploadsDir));
app.use("/img", express.static(path.resolve(__dirname, "public/img")));
app.use(express.static(path.join(__dirname, "public")));

// Inject footer links into every HTML page
app.use((req, res, next) => {
	const oldSend = res.send;
	res.send = function (data) {
		if (typeof data === "string" && data.includes("</body>")) {
			data = data.replace("</body>", `
<footer style="margin-top:40px;padding:20px;text-align:center;font-size:14px;color:#aaa;border-top:1px solid rgba(0,0,0,0.1);">
<a href="/privacy-policy.html">Privacy Policy</a> | <a href="/terms-and-conditions.html">Terms & Conditions</a>
</footer></body>`);
		}
		return oldSend.call(this, data);
	};
	next();
});

//--------------------------------------------
//	CHAT LOGIC
//--------------------------------------------

const openai = new OpenAI({	
	baseURL: "https://openrouter.ai/api/v1",
	apiKey: process.env.OPENROUTER_API_KEY,
	defaultHeaders: { 'HTTP-Referer': 'https://www.speaktoheaven.com', 'X-Title': 'Speak to Heaven' }
});

app.get("/api/chat/history", async (req, res) => {
	try {
		const authHeader = req.headers.authorization;
		const token = authHeader && authHeader.split(" ")[1];
		if (!token) return res.status(401).json({ error: "No token" });
		const decoded = jwt.verify(token, SECRET_KEY);
		const { characterId } = req.query;
		const history = await pool.query("SELECT * FROM messages WHERE user_id = $1 AND character_id = $2 ORDER BY created_at ASC LIMIT 50", [decoded.id, characterId]);
		res.json(history.rows);
	} catch (err) {
		res.status(500).json({ error: "Failed to load history" });
	}
});

app.post("/api/chat", authenticateToken, async (req, res) => {
	try {
		const { characterId, message } = req.body;
		if (!characterId || !message) return res.status(400).json({ error: "Missing character or message" });

		const character = biblicalProfiles.find(c => c.id === Number(characterId));
		if (!character) return res.status(400).json({ error: "Invalid character" });

		const userResult = await pool.query("SELECT plan, lifetime, expires_at, messages_sent FROM users WHERE id = $1", [req.user.id]);
		const userData = userResult.rows[0];
		const isPaid = userData.lifetime || (userData.expires_at && new Date(userData.expires_at) > new Date());

		if (!isPaid && parseInt(userData.messages_sent) >= 3) {
			return res.status(403).json({ error: "LIMIT_REACHED", message: "Limit reached. Please choose an offering." });
		}

		await pool.query(`INSERT INTO messages (user_id, character_id, from_user, text) VALUES ($1, $2, true, $3)`, [req.user.id, characterId, message]);

		const history = await pool.query(`SELECT * FROM messages WHERE user_id = $1 AND character_id = $2 ORDER BY created_at ASC LIMIT 20`, [req.user.id, characterId]);
		const chatHistory = history.rows.map(m => ({ role: m.from_user ? "user" : "assistant", content: m.text }));

		const systemPrompt = `You are ${character.name}, a biblical figure. ${character.description} RULES: Biblical tone, no AI mention, no modern tech.`;

		const aiResponse = await openai.chat.completions.create({	
			model: "openai/gpt-3.5-turbo",	
			messages: [{ role: "system", content: systemPrompt }, ...chatHistory, { role: "user", content: message }],
			temperature: 0.7, max_tokens: 400
		});

		const reply = aiResponse.choices?.[0]?.message?.content;
		if (reply) await pool.query(`INSERT INTO messages (user_id, character_id, from_user, text) VALUES ($1, $2, false, $3)`, [req.user.id, characterId, reply]);
		if (!isPaid) await pool.query("UPDATE users SET messages_sent = messages_sent + 1 WHERE id = $1", [req.user.id]);

		res.json({ reply: reply || "(No response)" });
	} catch (err) {
		res.status(500).json({ error: "Server Error" });
	}
});

app.get("/api/messages/:characterId", authenticateToken, async (req, res) => {
	try {
		const result = await pool.query(`SELECT * FROM messages WHERE user_id = $1 AND character_id = $2 ORDER BY created_at ASC`, [req.user.id, req.params.characterId]);
		res.json(result.rows);
	} catch (err) {
		res.status(500).json({ error: "Server error" });
	}
});

//--------------------------------------------
// SERVER PAGES / START
//--------------------------------------------

app.get("/", (req, res) => { res.send(`<!DOCTYPE html><html><head><title>Speak To Heaven</title></head><body><h1>Speak To Heaven</h1></body></html>`); });

app.get("/privacy-policy", (req, res) => res.sendFile(path.join(__dirname, "public", "privacy-policy.html")));
app.get("/terms", (req, res) => res.sendFile(path.join(__dirname, "public", "terms-and-conditions.html")));

app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));

app.listen(PORT, () => {
	console.log("======================================");
	console.log(`🌍 Port: ${PORT}`);
	console.log("======================================");
});