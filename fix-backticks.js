const fs = require('fs');
let content = fs.readFileSync('src/context/SimulationContext.tsx', 'utf8');
content = content.replace(/\\\`/g, '\`').replace(/\\\$\\{/g, '${');
fs.writeFileSync('src/context/SimulationContext.tsx', content);
