const fs = require('fs');
const parser = require('../');

process.chdir(__dirname)

let bf = fs.readFileSync('./a.png');


(async() => {
    //await
    let anim = parser(bf);

    console.log(anim);
    console.log(anim.frames[1]);

    anim.frames.forEach((f, i) => {
        fs.writeFileSync(`${i}.png`, f.data);
    });

})();