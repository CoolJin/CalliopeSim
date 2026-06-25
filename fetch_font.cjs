const https = require('https');
const fs = require('fs');

https.get('https://raw.githubusercontent.com/lancaster-university/microbit-dal/master/source/core/MicroBitFont.cpp', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const match = data.match(/const unsigned char pendolino3\[475\] = \s*\{([\s\S]*?)\};/);
    if (!match) {
      console.log('Array not found!');
      return;
    }
    const hexValues = match[1].split(',').map(s => s.trim()).filter(s => s.startsWith('0x') || s.match(/^[0-9]+$/));
    
    let result = 'export const font: Record<string, number[][]> = {\n';
    
    // ASCII 32 to 126
    for (let i = 0; i < 95; i++) {
      const asciiCode = i + 32;
      const charStr = String.fromCharCode(asciiCode);
      
      let charMatrix = [];
      for (let row = 0; row < 5; row++) {
        let valStr = hexValues[i * 5 + row];
        let val = parseInt(valStr, 16);
        let rowArr = [];
        rowArr.push((val & 0x10) ? 1 : 0);
        rowArr.push((val & 0x08) ? 1 : 0);
        rowArr.push((val & 0x04) ? 1 : 0);
        rowArr.push((val & 0x02) ? 1 : 0);
        rowArr.push((val & 0x01) ? 1 : 0);
        charMatrix.push(JSON.stringify(rowArr));
      }
      result += '  ' + JSON.stringify(charStr) + ': [' + charMatrix.join(',') + ']';
      if (i < 94) result += ',';
      result += '\n';
    }
    result += '};\n';
    fs.writeFileSync('src/font.ts', result);
    console.log('Generated src/font.ts with 95 characters!');
  });
});
