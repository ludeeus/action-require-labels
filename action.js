const fs = require("fs");

function runAction() {
    const eventData = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH))
    console.log(eventData)
}





runAction();