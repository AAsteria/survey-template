require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || "change-me";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/survey";

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// 托管前端静态文件（同源部署，无需额外 Web 服务器）
app.use(express.static(require("path").join(__dirname, "frontend")));

// ── MongoDB (serverless-safe, with connection caching) ──────
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose
      .connect(MONGODB_URI)
      .then((m) => {
        console.log("MongoDB connected (serverless)");
        return m;
      })
      .catch((err) => {
        console.error("MongoDB connection error:", err.message);
        cached.promise = null; // allow retry on next invocation
        throw err;
      });
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// Warm the connection at module load (non-blocking, won't crash on failure)
connectDB().catch(() => {});

// ── Schema ─────────────────────────────────────────────────
const submissionSchema = new mongoose.Schema(
  {
    name: { type: String, index: true },
    date: String,
    device: String,
    familiarity: String,
    overall_willingness: String,
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

const Submission = mongoose.model("Submission", submissionSchema);

// ── Auth middleware ────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Routes ─────────────────────────────────────────────────

// 提交问卷（无需鉴权）
app.post("/api/submissions", async (req, res) => {
  try {
    await connectDB();
    const { name, date, device, familiarity, overall_willingness, ...fields } =
      req.body;

    if (!name || !date) {
      return res.status(400).json({ error: "name 和 date 为必填" });
    }

    const doc = await Submission.create({
      name,
      date,
      device,
      familiarity,
      overall_willingness,
      data: fields,
    });

    res.status(201).json({ id: doc._id, message: "提交成功，感谢你的反馈！" });
  } catch (err) {
    console.error("POST /api/submissions error:", err);
    res.status(500).json({ error: "服务器错误: " + (err.message || err) });
  }
});

// 获取所有问卷（需鉴权）
app.get("/api/submissions", requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { device: { $regex: search, $options: "i" } },
        { "data.t1_path": { $regex: search, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      Submission.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Submission.countDocuments(filter),
    ]);

    res.json({ items, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error("GET /api/submissions error:", err);
    res.status(500).json({ error: "服务器错误" });
  }
});

// 获取单条问卷（需鉴权）
app.get("/api/submissions/:id", requireAuth, async (req, res) => {
  try {
    const doc = await Submission.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json(doc);
  } catch (err) {
    console.error("GET /api/submissions/:id error:", err);
    res.status(500).json({ error: "服务器错误" });
  }
});

// 删除问卷（需鉴权）
app.delete("/api/submissions/:id", requireAuth, async (req, res) => {
  try {
    const doc = await Submission.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: "Not found" });
    res.json({ message: "已删除" });
  } catch (err) {
    console.error("DELETE /api/submissions/:id error:", err);
    res.status(500).json({ error: "服务器错误" });
  }
});

// 导出 CSV（需鉴权）
app.get("/api/submissions/export/csv", requireAuth, async (req, res) => {
  try {
    const docs = await Submission.find().sort({ createdAt: -1 }).lean();

    // 收集所有可能的字段名
    const allKeys = new Set();
    docs.forEach((doc) => {
      if (doc.data && typeof doc.data === "object") {
        Object.keys(doc.data).forEach((k) => allKeys.add(k));
      }
    });
    const keys = Array.from(allKeys).sort();

    // CSV 表头
    const header = [
      "id",
      "name",
      "date",
      "device",
      "familiarity",
      "overall_willingness",
      "submittedAt",
      ...keys,
    ];

    // CSV 行
    const csvRows = [header.join(",")];
    docs.forEach((doc) => {
      const row = [
        doc._id,
        csvEscape(doc.name || ""),
        doc.date || "",
        doc.device || "",
        doc.familiarity || "",
        doc.overall_willingness || "",
        doc.createdAt || "",
        ...keys.map((k) =>
          csvEscape(
            doc.data && doc.data[k] !== undefined ? String(doc.data[k]) : ""
          )
        ),
      ];
      csvRows.push(row.join(","));
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="survey-export-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send("﻿" + csvRows.join("\n"));
  } catch (err) {
    console.error("CSV export error:", err);
    res.status(500).json({ error: "导出失败" });
  }
});

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", db: mongoose.connection.readyState === 1 });
});

// 鉴权校验（admin 面板登录用）
app.post("/api/auth", (req, res) => {
  const { secret } = req.body;
  if (secret === API_SECRET) {
    return res.json({ token: API_SECRET });
  }
  res.status(401).json({ error: "密钥错误" });
});

// ── Start / Export ─────────────────────────────────────────
// Vercel serverless 需要导出 app；本地直接 listen
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// ── Helpers ────────────────────────────────────────────────
function csvEscape(str) {
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
