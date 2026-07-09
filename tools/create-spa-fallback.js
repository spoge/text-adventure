const fs = require("fs");
const path = require("path");

const buildDir = path.join(__dirname, "..", "build");
const indexPath = path.join(buildDir, "index.html");
const fallbackPath = path.join(buildDir, "404.html");

fs.copyFileSync(indexPath, fallbackPath);
