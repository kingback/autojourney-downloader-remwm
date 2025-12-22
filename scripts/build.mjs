import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import crypto from 'crypto';
import { checkNodeVersion } from './version-check.mjs';

const filesSrc = 'src/files';
const outputDist = 'dist';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = pkg.version;

// 计算文件的SHA512校验和（使用流式处理以支持大文件）
function calculateSHA512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    
    stream.on('end', () => {
      resolve(hash.digest('base64'));
    });
    
    stream.on('error', (err) => {
      reject(err);
    });
  });
}

// 获取文件大小（字节）
function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

// 压缩文件夹为zip文件
function zipFolder(sourcePath, outputPath, forceZip64) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }, // 最大压缩级别
      forceZip64 // 强制启用 ZIP64 格式以支持超过 2GB 的文件
    });

    output.on('close', () => {
      console.log(`✅ 压缩完成: ${path.basename(sourcePath)} -> ${path.basename(outputPath)}`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourcePath, false);
    archive.finalize();
  });
}

// 生成info.json文件
function generateInfoJson(files) {
  const info = {
    version,
    files,
    releaseDate: new Date().toISOString()
  };
  return JSON.stringify(info, null, 2);
}

// 主构建函数
async function build() {
  try {
    // 检查 Node.js 版本
    checkNodeVersion();
    
    console.log(`🚀 开始构建版本: ${version}`);

    // 创建输出目录
    const outputDir = path.join(outputDist, version);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 读取files目录下的所有文件夹
    const filesDir = filesSrc;
    const items = fs.readdirSync(filesDir, { withFileTypes: true });
    const folders = items.filter(item => item.isDirectory());

    if (folders.length === 0) {
      console.log('❌ files目录下没有找到文件夹');
      process.exit(1);
    }

    console.log(`📁 找到 ${folders.length} 个文件夹:`);
    folders.forEach(folder => console.log(`  - ${folder.name}`));

    const files = [];

    // 压缩每个文件夹
    for (const folder of folders) {
      const sourcePath = path.join(filesDir, folder.name);
      const zipFileName = `${folder.name}.zip`;
      const outputPath = path.join(outputDir, zipFileName);
      const packageJsonPath = path.join(sourcePath, 'package.json');

      console.log(`📦 正在压缩: ${folder.name}`);

      // 复制 package.json 到文件夹中（支持覆盖）
      if (fs.existsSync(packageJsonPath)) {
        fs.unlinkSync(packageJsonPath);
      }
      fs.writeFileSync(packageJsonPath, JSON.stringify({
        ...pkg,
        name: folder.name
      }, null, 2));
      console.log(`  ✓ 已生成 package.json 到 ${folder.name}`);

      await zipFolder(sourcePath, outputPath);

      // 压缩完成后删除复制的 package.json
      fs.unlinkSync(packageJsonPath);
      console.log(`  ✓ 已删除临时 package.json`);

      // 计算文件信息
      const sha512 = await calculateSHA512(outputPath);
      const size = getFileSize(outputPath);

      files.push({
        url: zipFileName,
        sha512: sha512,
        size: size
      });

      console.log(`\n📊 ${folder.name}: ${(size / 1024 / 1024).toFixed(2)} MB`);
    }

    // 生成info.json文件
    const infoJson = generateInfoJson(files);
    const infoPath = path.join(outputDir, 'info.json');
    fs.writeFileSync(infoPath, infoJson);

    console.log(`\n✅ 构建完成!`);
    console.log(`📁 输出目录: ${outputDir}`);
    console.log(`📄 生成文件:`);
    files.forEach(file => {
      console.log(
        `  - ${file.url} (${(file.size / 1024 / 1024).toFixed(2)} MB)`
      );
    });
    console.log(`  - info.json`);

    // 返回构建信息供release脚本使用
    return {
      version,
      files,
      outputDir
    };

  } catch (error) {
    console.error(error);
    console.error('❌ 构建失败:', error.message);
    process.exit(1);
  }
}

// 直接运行此脚本
build();