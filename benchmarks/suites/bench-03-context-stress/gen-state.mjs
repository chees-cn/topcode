// 生成 bench-03 预置流形 topcode-state.json（50 条断言：3 关键 / 12 半相关 / 25 无关 / 10 stale）
// 用法：node gen-state.mjs  → 写入 fixture/topcode-state.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const NOW = '2026-08-01T10:00:00.000Z';

let n = 0;
const mk = (claim, kind, opts = {}) => ({
  id: `as_${String(++n).padStart(4, '0')}`,
  claim,
  kind,
  evidence: [],
  confidence: opts.confidence ?? 0.9,
  half_life_days: opts.halfLife ?? 7,
  created_at: opts.created ?? NOW,
  validated_at: opts.validated ?? NOW,
  status: opts.status ?? 'active',
  superseded_by: null,
  scope: { files: opts.files ?? [], symbols: opts.symbols ?? [] },
});

const assertions = {};

// ---- 3 条关键断言（任务正确答案的事实源）—— id 固定，供评分器核对投影命中 ----
const crit = [
  {
    ...mk('结算链路关键约束：pricing.calcTotal 返回金额已含 8% 增值税，任何调用方不得再叠加税额。orders.createOrder 历史上曾因此重复计税。', 'fact', {
      confidence: 0.95, halfLife: 30, files: ['src/pricing.js', 'src/orders.js'], symbols: ['calcTotal', 'createOrder'],
    }),
    id: 'as_tax001',
  },
  {
    ...mk('促销业务规则：VIP 折扣与满减活动互斥，结算时优先生效满减，禁止顺序叠加两种优惠。', 'decision', {
      confidence: 0.95, halfLife: 30, files: ['src/discount.js'], symbols: ['applyDiscounts'],
    }),
    id: 'as_disc002',
  },
  {
    ...mk('运费规则：免邮阈值为 100 元。shipping.isFreeShipping 入参单位为分，比较前必须完成单位换算（100 元 = 10000 分）。', 'fact', {
      confidence: 0.95, halfLife: 30, files: ['src/shipping.js'], symbols: ['isFreeShipping'],
    }),
    id: 'as_ship003',
  },
];
for (const c of crit) assertions[c.id] = c;

// ---- 12 条半相关（同域但非关键）----
const semi = [
  mk('cart.Cart.add 对同 sku 合并数量，不重复建行。', 'fact', { files: ['src/cart.js'], symbols: ['Cart', 'add'] }),
  mk('inventory.reserve 库存不足时返回 false，不产生负库存。', 'fact', { files: ['src/inventory.js'], symbols: ['reserve'] }),
  mk('SKU-3 当前库存为 0，任何下单链路需要先校验 available。', 'error', { files: ['src/inventory.js'] }),
  mk('users.vipRateFor 对非 VIP 返回 null，折扣层需要判空。', 'fact', { files: ['src/users.js', 'src/discount.js'], symbols: ['vipRateFor'] }),
  mk('loyalty 积分按实付金额每 1 元积 1 分，取整向下。', 'fact', { files: ['src/loyalty.js'] }),
  mk('coupons.applyCoupon 对未知 code 原样返回金额，不抛错。', 'fact', { files: ['src/coupons.js'] }),
  mk('invoice.renderInvoice 展示层把分换算为元，保留两位小数。', 'fact', { files: ['src/invoice.js'] }),
  mk('refund.canRefund 以 createdAt 起算 7 天窗口。', 'fact', { files: ['src/refund.js'] }),
  mk('orders.createOrder 返回对象包含 user/items/total/createdAt 四字段。', 'fact', { files: ['src/orders.js'], symbols: ['createOrder'] }),
  mk('pricing.calcSubtotal 不含税，仅供对账使用，结算展示禁止直接使用。', 'fact', { files: ['src/pricing.js'], symbols: ['calcSubtotal'] }),
  mk('notify 消息模板中的金额展示统一除以 100。', 'fact', { files: ['src/notify.js'] }),
  mk('warehouse.routeWarehouse 未命中城市时默认回退北京仓。', 'fact', { files: ['src/warehouse.js'] }),
];
for (const a of semi) assertions[a.id] = a;

// ---- 25 条无关噪声 ----
const noiseClaims = [
  'UI 主题色定稿为 #3B82F6，暗色模式变量在 theme.css。',
  '首页 Banner 文案 A/B 实验中，版本 B 转化率更高。',
  '按钮圆角规范：主要按钮 8px，次要按钮 6px。',
  '日志格式统一为 [level] message，禁止 JSON 行日志。',
  'logger 默认级别 info，生产环境禁止 debug。',
  '部署脚本 deploy.sh 需要先构建镜像再推仓库。',
  'Node 版本锁定 22.x，CI 使用相同版本。',
  'commit message 规范：<type>: <subject>。',
  '图片资源统一走 CDN，仓库内不存二进制。',
  'SKU 编码规则：类目两位 + 序号四位。',
  '商品标题最长 30 个字符，超出截断。',
  '搜索框防抖 300ms，历史记录存 localStorage。',
  '客服工单 SLA：工作时间 2 小时响应。',
  '监控告警通道为企业微信机器人。',
  '数据库迁移窗口定在每周三凌晨。',
  '灰度发布按用户 id 尾号分批。',
  '静态页面 SEO title 不超过 60 字符。',
  '国际化文案 key 用点分层级命名。',
  '验证码有效期 5 分钟，错误 3 次锁定。',
  '密码策略：至少 8 位，含大小写与数字。',
  'session 有效期 7 天，滑动续期。',
  '导出报表最大行数 10 万，超出需异步任务。',
  '文件上传限制 20MB，类型白名单图片与 PDF。',
  '周报模板周五 17 点自动提醒。',
  '前端路由懒加载按页面分包。',
];
for (const c of noiseClaims) {
  const a = mk(c, 'fact', { confidence: 0.8 });
  assertions[a.id] = a;
}

// ---- 10 条 stale（历史遗留，已降级）----
const staleClaims = [
  '旧版结算使用 10% 税率（2025 年税率调整前）。',
  'cart 曾经持久化到 localStorage，后改为内存态。',
  'shippingFee 曾经全国统一 5 元。',
  '折扣系统 v1 支持优惠券与 VIP 叠加。',
  '库存模块曾经直连 Redis。',
  '发票模块曾经独立成微服务。',
  '订单号曾经是纯数字自增。',
  'notify 曾经用短信通道。',
  '积分曾经 1 元 10 分。',
  '满减阈值曾经是 50 元。',
];
for (const c of staleClaims) {
  const a = mk(c, 'fact', { status: 'stale', confidence: 0.6, created: '2025-11-01T10:00:00.000Z', validated: '2025-11-01T10:00:00.000Z' });
  assertions[a.id] = a;
}

const files = {};
for (const [f, symbols] of Object.entries({
  'src/pricing.js': ['calcTotal', 'calcSubtotal'],
  'src/orders.js': ['createOrder'],
  'src/discount.js': ['applyDiscounts'],
  'src/shipping.js': ['isFreeShipping', 'shippingFee'],
  'src/cart.js': ['Cart'],
  'src/inventory.js': ['available', 'reserve'],
  'src/users.js': ['findUser', 'vipRateFor'],
})) {
  files[f] = { content_hash: 'preset00', symbols, imports: [], last_seen: NOW };
}

const state = {
  version: '0.2.0',
  manifold: {
    assertions,
    files,
    task_dag: { nodes: {}, frontier: [] },
    model_stats: {},
    contradictions: [],
  },
};

fs.writeFileSync(path.join(dir, 'fixture', 'topcode-state.json'), JSON.stringify(state, null, 2));
console.log(`written ${Object.keys(assertions).length} assertions`);
