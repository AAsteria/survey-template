# 点读机问卷 — 部署指南

## 整体架构（一次部署，前后端一体）

```
用户浏览器 ──→ Render.com (同一个 Web Service)
                   │
                   ├── /                       → 问卷页 (questionnaire.html)
                   ├── /admin.html             → 管理后台
                   ├── /api/submissions        → 问卷提交 / 查询
                   ├── /api/auth               → 管理员登录
                   └── /api/submissions/export/csv → CSV 导出
                          │
                          └──→ MongoDB Atlas (免费 M0)
```

前端和 API 同源部署，HTML 里 `API_BASE` 留空即可，不涉及跨域。

---

## 第一步：MongoDB Atlas（免费）

### 1.1 创建集群
1. [cloud.mongodb.com](https://cloud.mongodb.com) 注册/登录
2. **Create Cluster** → **M0 FREE**（512MB，免费）
3. Provider 随便，Region 选离你最近的（Singapore / Hong Kong）
4. 点 **Create Deployment**

### 1.2 创建用户
1. 左侧 **Database Access** → **Add New Database User**
2. 认证方式：**Password**
3. 用户名：`survey_admin`，密码记下来
4. 权限：**Read and write to any database**

### 1.3 网络
1. 左侧 **Network Access** → **Add IP Address**
2. 选 **Allow Access from Anywhere**

### 1.4 获取连接串
1. **Database** → 点集群的 **Connect** → **Drivers**
2. 复制连接串，替换 `<password>` 并在末尾 `?` 前加上 `/survey`：
   ```
   mongodb+srv://survey_admin:你的密码@cluster0.xxxxx.mongodb.net/survey?retryWrites=true&w=majority
   ```
3. 这是 **MONGODB_URI**，记下来。

---

## 第二步：部署到 Render（免费）

### 2.1 把 survey-backend 上传到 GitHub

这个目录需要是一个独立的 GitHub repo（或 monorepo 的一个子目录）。需要上传的文件：

```
survey-backend/
├── frontend/
│   ├── questionnaire.html    ← 问卷页
│   └── admin.html            ← 管理后台
├── server.js                 ← Express（API + 静态文件）
├── package.json
├── .env.example
└── .gitignore
```

### 2.2 在 Render 创建 Web Service
1. [render.com](https://render.com) 用 GitHub 登录
2. **New +** → **Web Service** → 连接你的 GitHub repo
3. 如果整个 repo 不止 survey-backend，**Root Directory** 填 `survey-backend`
4. 配置：

| 字段 | 值 |
|---|---|
| **Name** | `dian du ji -survey`（随便） |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Instance Type** | Free |

### 2.3 设置环境变量
点 **Environment**，添加：

| Key | Value |
|---|---|
| `MONGODB_URI` | 第一步的 MongoDB 连接串 |
| `API_SECRET` | 自定义复杂字符串（admin 登录用） |

### 2.4 部署 & 验证
点 **Create Web Service**，等 2-3 分钟。部署后你会得到：
```
https://dian du ji -survey.onrender.com
```

验证：
- `https://你的地址.onrender.com/api/health` → `{"status":"ok","db":true}`
- `https://你的地址.onrender.com/` → 问卷页
- `https://你的地址.onrender.com/admin.html` → 管理后台

> 免费实例 15 分钟无请求会休眠，首请求需等 30-60 秒唤醒。

---

## 第三步：使用

### 发给内测用户
把问卷 URL 发给用户：
```
https://dian du ji -survey.onrender.com/
```

用户打开后：
1. 填写基本信息，按任务指引逐个完成
2. 数据自动保存浏览器（刷新不丢）
3. 提交后 POST 到 MongoDB
4. 如果 API 不可用，自动回退下载 JSON

### 管理员查看
打开 `https://你的地址.onrender.com/admin.html`：
1. 输入 `API_SECRET` 登录
2. 列表查看 → 点行看详情
3. 搜索、删除、导出 CSV

---

## 本地测试

```bash
cd survey-backend

# 1. 安装
npm install

# 2. 配置
cp .env.example .env
# 编辑 .env，填入 MONGODB_URI 和 API_SECRET

# 3. 启动
npm run dev
```

浏览器打开 `http://localhost:3000` 即可测试问卷页，`http://localhost:3000/admin.html` 测试后台。
