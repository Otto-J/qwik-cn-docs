#!/usr/bin/env node

/**
 * Qwik 中文文档自动化翻译脚本
 *
 * 功能:
 * - 检测 docs 分支和 translate 分支的差异
 * - 提取并翻译新增/修改的 MDX 文件
 * - 支持增量翻译(只翻译变更部分)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const asyncPool = require('tiny-async-pool');
const {
  parseMDX,
  extractDiffHunks,
  alignToParagraphs,
  mergeTranslation,
  batchParagraphs
} = require('./translate-utils');

// 配置
const DOCS_BRANCH = 'origin/docs';
const TRANSLATE_BRANCH = 'HEAD';
const DOCS_DIR = path.join(__dirname, '../docs');
const REPO_ROOT = path.join(__dirname, '..');

// AI 翻译配置 (从环境变量读取)
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const DASHSCOPE_API_URL = process.env.DASHSCOPE_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 执行 git 命令并返回结果
 */
function gitExec(cmd, options = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      cwd: REPO_ROOT,
      ...options
    });
  } catch (error) {
    if (options.ignoreError) return '';
    throw error;
  }
}

/**
 * 获取两个分支之间的文件变更
 */
function getChangedFiles() {
  console.log('🔍 检测文件变更...');

  // 获取所有变更的 .mdx 文件
  const diffOutput = gitExec(
    `git diff --name-status ${DOCS_BRANCH}...${TRANSLATE_BRANCH} "*.mdx"`,
    { ignoreError: true }
  );

  if (!diffOutput.trim()) {
    console.log('✅ 没有检测到文件变更');
    return [];
  }

  const files = diffOutput.trim().split('\n').map(line => {
    const [status, ...filePathParts] = line.split('\t');
    const fullPath = filePathParts.join('\t').trim();
    // 转换路径: docs/src/... -> src/...
    const relativePath = fullPath.startsWith('docs/')
      ? fullPath.substring(5)
      : fullPath;
    return {
      status: status.trim(),
      path: fullPath,
      relativePath
    };
  }).filter(f => f.path);

  console.log(`📝 检测到 ${files.length} 个变更文件`);
  return files;
}

/**
 * 获取文件的详细 diff
 * @param {string} fullPath - 仓库根目录相对路径 (如 docs/src/...)
 */
function getFileDiff(fullPath) {
  try {
    const diffOutput = gitExec(
      `git diff --unified=3 ${DOCS_BRANCH}...${TRANSLATE_BRANCH} -- "${fullPath}"`,
      { ignoreError: true }
    );
    return diffOutput;
  } catch (error) {
    console.warn(`⚠️  无法获取文件 diff: ${fullPath}`);
    return '';
  }
}

/**
 * 读取文件内容
 */
function readFile(filePath) {
  const fullPath = path.join(DOCS_DIR, filePath);
  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * 写入翻译后的文件
 */
function writeFile(filePath, content) {
  const fullPath = path.join(DOCS_DIR, filePath);
  fs.writeFileSync(fullPath, content, 'utf-8');
}

/**
 * 调用 AI 翻译接口 (阿里云 DashScope)
 *
 * 使用占位符方案保护代码块：
 * 1. 预处理：提取代码块，替换为 __CODE_BLOCK_N__
 * 2. 翻译：只翻译非代码块内容
 * 3. 后处理：还原代码块
 */
async function translateWithAI(text, filePath = '') {
  if (!DASHSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_API_KEY 环境变量未配置');
  }

  // 预处理：提取代码块，用占位符替换
  const codeBlocks = [];
  const processedText = text.replace(/\`\`\`[\s\S]*?\`\`\`/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  const systemPrompt = `翻译技术文档为中文。保留 __CODE_BLOCK_N__ 标记和专有名词（Qwik、React 等）。`;

  const userPrompt = `翻译：\n${processedText}`;

  console.log('📤 调用 AI 翻译...');

  try {
    // 使用临时文件避免 shell 转义问题
    const requestData = {
      model: 'qwen-plus',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    };

    const tmpFile = `/tmp/dashscope-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.json`;
    fs.writeFileSync(tmpFile, JSON.stringify(requestData));

    const response = execSync(
      `curl -s -X POST "${DASHSCOPE_API_URL}" \\
        -H "Authorization: Bearer ${DASHSCOPE_API_KEY}" \\
        -H "Content-Type: application/json" \\
        -d @${tmpFile}`,
      { encoding: 'utf-8' }
    );

    // 清理临时文件
    fs.unlinkSync(tmpFile);

    const result = JSON.parse(response);
    if (result.choices && result.choices[0] && result.choices[0].message) {
      let translated = result.choices[0].message.content.trim();

      // 后处理：还原代码块
      codeBlocks.forEach((block, i) => {
        translated = translated.replace(`__CODE_BLOCK_${i}__`, block);
      });

      return translated;
    }

    throw new Error('API 响应格式错误: ' + JSON.stringify(result));
  } catch (error) {
    console.error('❌ AI 翻译失败:', error.message);
    throw error;
  }
}

/**
 * 处理新增文件 - 全文翻译（批量 + 并发）
 */
async function handleNewFile(fileInfo) {
  console.log(`\n📄 处理新增文件: ${fileInfo.relativePath}`);

  const content = readFile(fileInfo.relativePath);
  const parsed = parseMDX(content);

  console.log(`  - 提取到 ${parsed.paragraphs.length} 个段落`);

  // 批量合并段落（每批最多 2000 字符）
  const batches = batchParagraphs(parsed.paragraphs, 2000);
  console.log(`  - 合并为 ${batches.length} 个批次（原 ${parsed.paragraphs.length} 个段落）`);

  // 并发翻译批次
  const CONCURRENCY = 10;
  const translatedParagraphs = new Array(parsed.paragraphs.length);

  for await (const result of asyncPool(CONCURRENCY, batches, async (batch, batchIndex) => {
    console.log(`  - 翻译批次 ${batchIndex + 1}/${batches.length} (${batch.indices.length}个段落)...`);

    // 使用特殊分隔符合并段落
    const SEP = '___PARAGRAPH_SEP___';
    const combinedText = batch.text.split('\n\n').join('\n\n' + SEP + '\n\n');

    // 翻译
    const translatedCombined = await translateWithAI(combinedText, fileInfo.relativePath);

    // 分割回段落
    const translatedParts = translatedCombined.split(SEP).map(s => s.trim());

    // 映射回原段落索引
    const results = [];
    for (let i = 0; i < batch.indices.length; i++) {
      results.push({
        index: batch.indices[i],
        translated: translatedParts[i] || translatedParts[translatedParts.length - 1]
      });
    }
    return results;
  })) {
    for (const item of result) {
      translatedParagraphs[item.index] = item.translated;
    }
  }

  // 重建文件内容
  const translatedContent = mergeTranslation(parsed, translatedParagraphs);
  writeFile(fileInfo.relativePath, translatedContent);

  console.log(`  ✅ 完成: ${fileInfo.relativePath}`);
}

/**
 * 处理修改文件 - 增量翻译（批量 + 并发）
 */
async function handleModifiedFile(fileInfo) {
  console.log(`\n📝 处理修改文件: ${fileInfo.relativePath}`);

  const diff = getFileDiff(fileInfo.path);  // 使用完整路径
  if (!diff) {
    console.log(`  ⚠️  跳过: 无法获取 diff`);
    return;
  }

  const hunks = extractDiffHunks(diff);
  console.log(`  - 检测到 ${hunks.length} 个变更块`);

  const content = readFile(fileInfo.relativePath);  // 使用相对路径读取
  const parsed = parseMDX(content);

  // 将变更行对齐到段落
  const paragraphsToTranslate = alignToParagraphs(hunks, parsed);

  if (paragraphsToTranslate.length === 0) {
    console.log(`  ✅ 无需翻译的段落变更`);
    return;
  }

  console.log(`  - 需要翻译 ${paragraphsToTranslate.length} 个段落`);

  // 提取需要翻译的段落
  const paragraphsOnly = paragraphsToTranslate.map(p => p.paragraph);

  // 批量合并
  const batches = batchParagraphs(paragraphsOnly, 2000);
  console.log(`  - 合并为 ${batches.length} 个批次`);

  // 并发翻译批次
  const CONCURRENCY = 10;

  for await (const batchResults of asyncPool(CONCURRENCY, batches, async (batch, batchIndex) => {
    console.log(`  - 翻译批次 ${batchIndex + 1}/${batches.length} (${batch.indices.length}个段落)...`);

    const SEP = '___PARAGRAPH_SEP___';
    const combinedText = batch.text.split('\n\n').join('\n\n' + SEP + '\n\n');

    const translatedCombined = await translateWithAI(combinedText, fileInfo.relativePath);

    const translatedParts = translatedCombined.split(SEP).map(s => s.trim());

    const results = [];
    for (let i = 0; i < batch.indices.length; i++) {
      const originalIndex = paragraphsToTranslate[batch.indices[i]].index;
      results.push({
        index: originalIndex,
        translated: translatedParts[i] || translatedParts[translatedParts.length - 1]
      });
    }
    return results;
  })) {
    for (const item of batchResults) {
      parsed.paragraphs[item.index] = item.translated;
    }
  }

  // 重建文件内容
  const translatedContent = mergeTranslation(parsed, parsed.paragraphs);
  writeFile(fileInfo.relativePath, translatedContent);

  console.log(`  ✅ 完成: ${fileInfo.relativePath}`);
}

/**
 * 处理删除文件
 */
function handleDeletedFile(fileInfo) {
  console.log(`\n🗑️  处理删除文件: ${fileInfo.relativePath}`);

  const fullPath = path.join(DOCS_DIR, fileInfo.relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    console.log(`  ✅ 已删除: ${fileInfo.relativePath}`);
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('  Qwik 中文文档自动化翻译');
  console.log('========================================\n');

  try {
    // 检查环境变量
    if (!DASHSCOPE_API_KEY) {
      console.warn('⚠️  警告: DASHSCOPE_API_KEY 未配置');
      console.warn('   请在 GitHub Secrets 中配置 DASHSCOPE_API_KEY\n');
    }

    // 获取变更文件
    const changedFiles = getChangedFiles();

    if (changedFiles.length === 0) {
      console.log('\n✅ 没有需要翻译的文件');
      return;
    }

    // 限制处理文件数量（测试用）
    const MAX_FILES = parseInt(process.env.MAX_FILES || '0');
    const filesToProcess = MAX_FILES > 0 ? changedFiles.slice(0, MAX_FILES) : changedFiles;
    if (MAX_FILES > 0 && changedFiles.length > MAX_FILES) {
      console.log(`🧪 测试模式：只处理前 ${MAX_FILES} 个文件（共 ${changedFiles.length} 个）\n`);
    }

    // 分类处理文件
    const stats = { new: 0, modified: 0, deleted: 0 };

    for (const file of filesToProcess) {
      try {
        switch (file.status) {
          case 'A': // 新增
            await handleNewFile(file);
            stats.new++;
            break;
          case 'M': // 修改
            await handleModifiedFile(file);
            stats.modified++;
            break;
          case 'D': // 删除
            handleDeletedFile(file);
            stats.deleted++;
            break;
          default:
            console.log(`⚠️  跳过未知状态: ${file.status} ${file.path}`);
        }
      } catch (error) {
        console.error(`❌ 处理文件失败: ${file.relativePath}`);
        console.error(`   错误: ${error.message}`);
      }
    }

    // 输出统计
    console.log('\n========================================');
    console.log('  翻译完成');
    console.log('========================================');
    console.log(`📊 统计:`);
    console.log(`  - 新增文件: ${stats.new}`);
    console.log(`  - 修改文件: ${stats.modified}`);
    console.log(`  - 删除文件: ${stats.deleted}`);
    console.log(`  - 本次处理: ${stats.new + stats.modified + stats.deleted}/${changedFiles.length}`);
    console.log('');

  } catch (error) {
    console.error('\n❌ 翻译过程出错:', error.message);
    process.exit(1);
  }
}

// 运行
main();
