const { z } = require('zod');

const leaderboardSchema = z.object({
  player: z.string().trim().min(1).max(32),
  rank: z.string().trim().min(1).max(64),
  points: z.coerce.number().int().min(0).max(9999),
  testServer: z.string().trim().max(64).optional().or(z.literal('')).transform((v) => (v ? String(v) : null))
}).passthrough();

const quickEditSchema = z.object({
  points: z.coerce.number().int().min(0).max(9999).optional(),
  rank: z.string().trim().min(1).max(64).optional(),
  testServer: z.string().trim().max(64).optional().or(z.literal('')).transform((v) => (v == null ? undefined : (v ? String(v) : null)))
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128)
});

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_\-]+$/, '用户名只能包含字母、数字、下划线、横线'),
  email: z.string().trim().toLowerCase().email().max(128),
  password: z.string().min(8).max(128),
  passwordConfirm: z.string().min(8).max(128)
}).refine((d) => d.password === d.passwordConfirm, { message: '两次输入的密码不一致', path: ['passwordConfirm'] });

const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(128)
});

const verifyCodeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(128),
  code: z.string().trim().regex(/^\d{6}$/, '验证码必须为 6 位数字')
});

const resetSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(128),
  code: z.string().trim().regex(/^\d{6}$/, '验证码必须为 6 位数字'),
  password: z.string().min(8).max(128),
  passwordConfirm: z.string().min(8).max(128)
}).refine((d) => d.password === d.passwordConfirm, { message: '两次输入的密码不一致', path: ['passwordConfirm'] });

const resendVerifySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(128)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().max(128).optional().or(z.literal('')).transform((v) => v || ''),
  password: z.string().min(8).max(128),
  passwordConfirm: z.string().min(8).max(128)
}).refine((d) => d.password === d.passwordConfirm, { message: '两次输入的密码不一致', path: ['passwordConfirm'] });

const settingsSchema = z.object({
  registrationEnabled: z.coerce.boolean().or(z.string().transform((v) => v === 'on' || v === 'true')).default(false),
  oauthEnabled: z.coerce.boolean().or(z.string().transform((v) => v === 'on' || v === 'true')).default(false),
  oauthClientId: z.string().trim().max(256).optional().or(z.literal('')),
  oauthTenant: z.string().trim().max(64).optional().or(z.literal(''))
});

const categoryNameSchema = z.string().trim().min(1).max(48).regex(/^[A-Za-z0-9 _\-]+$/, '名称只能包含字母、数字、空格、下划线、横线');

const categoryAddSchema = z.object({ name: categoryNameSchema });
const categoryRenameSchema = z.object({ from: categoryNameSchema, to: categoryNameSchema });
const categoryDeleteSchema = z.object({ name: categoryNameSchema });

function parseCategoryPayload(body) {
  const categories = {};
  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('category__')) {
      const categoryName = key.replace('category__', '').trim();
      if (!categoryName) continue;
      const normalized = String(value || '').trim();
      categories[categoryName] = normalized.length > 0 ? normalized : null;
    }
  }
  return categories;
}

module.exports = {
  leaderboardSchema,
  quickEditSchema,
  loginSchema,
  registerSchema,
  forgotSchema,
  verifyCodeSchema,
  resetSchema,
  resendVerifySchema,
  changePasswordSchema,
  settingsSchema,
  categoryAddSchema,
  categoryRenameSchema,
  categoryDeleteSchema,
  parseCategoryPayload
};
