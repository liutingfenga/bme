#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

const templates = {
  minimal: 'Minimal setup (core only)',
  vue: 'Vue.js web application',
  react: 'React web application',
  'node-cli': 'Node.js CLI tool',
  umd: 'Browser UMD (<script> tag)',
}

const projectName = args[0] || 'my-bme-app'

// Handle special flags
if (args.includes('--list')) {
  console.log(JSON.stringify(Object.entries(templates).map(([k, v]) => ({ id: k, name: v })), null, 2))
  process.exit(0)
}

if (args.includes('--json')) {
  console.log(JSON.stringify({
    version: '0.1.0',
    templates: Object.entries(templates).map(([k, v]) => ({ id: k, name: v })),
    projectName,
  }, null, 2))
  process.exit(0)
}

// Default: create with 'minimal' template
const templateId = args.includes('--defaults') ? 'minimal' : 'minimal'

const srcDir = path.join(__dirname, 'templates', templateId)
const destDir = path.join(process.cwd(), projectName)

// Create project directory
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true })
}

// Copy template files
function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Template not found: ${src}`)
    process.exit(1)
  }
  
  const items = fs.readdirSync(src, { withFileTypes: true })
  for (const item of items) {
    const srcPath = path.join(src, item.name)
    const destPath = path.join(dest, item.name)
    
    if (item.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

try {
  copyDir(srcDir, destDir)
  
  console.log(`✓ Created ${templateId} template at ${destDir}`)
  console.log(`\nNext steps:`)
  console.log(`  cd ${projectName}`)
  console.log(`  npm install`)
  console.log(`  npm run dev`)
} catch (err) {
  console.error('Error creating project:', err.message)
  process.exit(1)
}
