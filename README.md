# CN Subtiers

中文 Minecraft 1.9+ PvP Subtier 榜单网站，支持：

- 如需初始化榜单，可在仓库根目录放置 `1.9+Subtier Overall(1).xlsx`，启动时会自动导入
- 前台展示榜单（搜索玩家、展示各模式 Subtier）
- 管理员后台（登录验证 + 新增/编辑/删除榜单）
- 安全能力（会话管理、CSRF 防护、登录限流、输入校验、安全响应头）

## 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

启动后访问：

- 前台：`http://localhost:3000/`
- 后台登录：`http://localhost:3000/admin/login`

## 默认管理员

如果没有配置环境变量，系统会自动创建默认管理员：

- 用户名：`admin`
- 密码：`ChangeMe_12345`

> 强烈建议在 `.env` 中修改为你自己的安全账号密码。

## 环境变量

参考 `.env.example`：

- `PORT`：端口
- `NODE_ENV`：运行环境（生产环境请使用 `production`）
- `SESSION_SECRET`：会话密钥（生产环境必须设置高强度随机值）
- `ADMIN_USERNAME`：管理员用户名
- `ADMIN_PASSWORD`：管理员密码（首次启动时用于初始化）

## 外部 API

只读 JSON 接口，挂在 `/api/v1/` 下，公开访问、按 IP 限流（60 次/分钟）、允许跨域。详细设计见 [docs/superpowers/specs/2026-05-12-public-api-design.md](docs/superpowers/specs/2026-05-12-public-api-design.md)。

```bash
# 列出全部 gamemode
curl http://localhost:3000/api/v1/gamemodes

# 总榜（默认 50 条）
curl 'http://localhost:3000/api/v1/rankings?limit=20&offset=0'

# 单个 gamemode 的 tier 排名（5 个 tier 桶，每桶 count 条，HT 优先于 LT）
curl 'http://localhost:3000/api/v1/rankings/Cart?count=10&offset=0'

# 单个玩家详情（包含所有 gamemode 的 tier 段位，未上榜为 null）
curl http://localhost:3000/api/v1/players/SharkIrene
```

错误响应统一形如 `{ "error": "code", "message": "..." }`。错误码：`invalid_query` (400)、`not_found` / `gamemode_not_found` (404)、`rate_limited` (429)、`internal_error` (500)。
