// Кладёт актуальный дашборд внутрь приложения перед сборкой и запуском.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'dashboard_kachestvo_moyki.html');
const dst = path.join(__dirname, 'dashboard.html');
fs.copyFileSync(src, dst);
console.log('dashboard.html обновлён из', path.relative(process.cwd(), src));
