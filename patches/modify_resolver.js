const fs = require('fs');

// 用法：node modify_resolver.js <编译后的 admin-panel.resolver.js 路径>
// 默认路径与 ECS 上当时使用的一致。
const path = process.argv[2] || '/opt/twenty-crm/admin-panel.resolver.js';
let c = fs.readFileSync(path, 'utf8');

// 替换 getModelsDevProviders：models.dev 为空时返回默认 OpenAI 兼容 provider
const patched = c.replace(
  /async getModelsDevProviders\(\)\s*\{[\s\S]*?return this\.modelsDevCatalogService\.getProviderSuggestions\(\);[\s\S]*?\}/,
  `async getModelsDevProviders() {
        try {
            var suggestions = await this.modelsDevCatalogService.getProviderSuggestions();
            if (suggestions && suggestions.length > 0) return suggestions;
        } catch (e) {}
        return [{ id: 'openai', modelCount: 0, npm: '@ai-sdk/openai' }];
    }`,
);

if (patched === c) {
  console.error('WARN: pattern not found, file unchanged');
  process.exit(1);
}

fs.writeFileSync(path, patched);
console.log('DONE');
