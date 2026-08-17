// 评分器：约束总结（投影召回端到端探针）—— stdout 须命中三条关键约束的语义关键词
import fs from 'node:fs';

const [, , , stdoutPath] = process.argv;
const out = fs.readFileSync(stdoutPath, 'utf8');

const checks = [
  { name: 'tax-included-known', pass: /含税|已含.*税|不得.*(再|重复).*税|重复计税/.test(out) },
  { name: 'discount-mutex-known', pass: /互斥|不可叠加|不能叠加|禁止叠加/.test(out) },
  { name: 'shipping-unit-known', pass: /100\s*元|10000\s*分|单位.*分|分.*单位|换算/.test(out) },
];

const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ score: passed / checks.length, checks }));
