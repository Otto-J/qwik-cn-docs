/**
 * Qwik 中文文档翻译工具函数
 *
 * 提供 MDX 解析、diff 处理、段落对齐等功能
 */

/**
 * MDX 解析器
 *
 * 分离文件内容为:
 * - frontmatter: 元数据区域
 * - imports: JSX 导入语句
 * - paragraphs: 正文段落列表
 * - paragraphLineNumbers: 每个段落的起始行号
 */
function parseMDX(content) {
  const lines = content.split('\n');

  let frontmatter = [];
  let imports = [];
  let paragraphs = [];
  let paragraphLineNumbers = [];

  let state = 'start'; // start | frontmatter | imports | content
  let currentParagraph = [];
  let contentStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测 frontmatter 开始
    if (state === 'start' && line.trim() === '---') {
      state = 'frontmatter';
      frontmatter.push(line);
      continue;
    }

    // 检测 frontmatter 结束
    if (state === 'frontmatter' && line.trim() === '---') {
      frontmatter.push(line);
      state = 'imports';
      continue;
    }

    // 收集 frontmatter
    if (state === 'frontmatter') {
      frontmatter.push(line);
      continue;
    }

    // 检测并收集 imports
    if (state === 'imports') {
      const trimmed = line.trim();
      // import 语句通常以 'import' 开头
      if (trimmed.startsWith('import ') && (trimmed.includes(' from ') || trimmed.endsWith(';'))) {
        imports.push(line);
        continue;
      }
      // 空行后进入内容区域
      if (trimmed === '' || !trimmed.startsWith('import')) {
        state = 'content';
        contentStartLine = i;
      }
    }

    // 收集内容段落
    if (state === 'content') {
      const trimmed = line.trim();

      // 空行表示段落结束
      if (trimmed === '') {
        if (currentParagraph.length > 0) {
          paragraphs.push(currentParagraph.join('\n'));
          paragraphLineNumbers.push(i - currentParagraph.length);
          currentParagraph = [];
        }
        continue;
      }

      currentParagraph.push(line);
    }
  }

  // 处理最后一个段落
  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph.join('\n'));
    paragraphLineNumbers.push(lines.length - currentParagraph.length);
  }

  return {
    frontmatter: frontmatter.join('\n'),
    imports: imports.join('\n'),
    paragraphs,
    paragraphLineNumbers,
    totalLines: lines.length
  };
}

/**
 * 解析 Git diff hunks
 *
 * 从 diff 输出中提取所有变更块 (hunks)
 */
function extractDiffHunks(diffOutput) {
  const hunks = [];
  const lines = diffOutput.split('\n');

  let currentHunk = null;
  let oldStart = 0;
  let newStart = 0;

  for (const line of lines) {
    // 解析 hunk 头部: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ \-(\d+),?\d* \+(\d+),?\d* @@/);
    if (hunkMatch) {
      if (currentHunk) {
        hunks.push(currentHunk);
      }
      oldStart = parseInt(hunkMatch[1], 10);
      newStart = parseInt(hunkMatch[2], 10);
      currentHunk = {
        oldStart,
        newStart,
        lines: []
      };
      continue;
    }

    // 收集 hunk 内容行
    if (currentHunk) {
      // 下一个 hunk 开始
      if (line.startsWith('@@') && line.includes('-') && line.includes('+')) {
        hunks.push(currentHunk);
        const match = line.match(/^@@ \-(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          oldStart = parseInt(match[1], 10);
          newStart = parseInt(match[2], 10);
          currentHunk = {
            oldStart,
            newStart,
            lines: []
          };
        }
        continue;
      }

      // 跳过 diff 头部信息
      if (line.startsWith('diff') ||
          line.startsWith('index') ||
          line.startsWith('---') ||
          line.startsWith('+++') ||
          line.startsWith('new file') ||
          line.startsWith('deleted file')) {
        continue;
      }

      currentHunk.lines.push(line);
    }
  }

  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

/**
 * 将变更行对齐到段落边界
 *
 * @param {Array} hunks - diff hunks
 * @param {Object} parsed - 解析后的 MDX 内容
 * @returns {Array} 需要翻译的段落列表 [{ index, paragraph }]
 */
function alignToParagraphs(hunks, parsed) {
  const { paragraphLineNumbers, paragraphs } = parsed;
  const paragraphsToTranslate = new Set();

  for (const hunk of hunks) {
    const { newStart, lines } = hunk;

    // 计算变更涉及的行范围
    const changedLines = new Set();
    let currentLine = newStart;

    for (const line of lines) {
      const code = line[0];

      if (code === '+') {
        // 新增行
        changedLines.add(currentLine);
      } else if (code === '-') {
        // 删除行不增加 currentLine
        continue;
      } else if (code === ' ') {
        // 上下文行
        currentLine++;
      } else if (code === '\\') {
        // diff 元数据行
        continue;
      }
    }

    // 将变更行映射到段落
    for (const line of changedLines) {
      for (let i = 0; i < paragraphLineNumbers.length; i++) {
        const paraStart = paragraphLineNumbers[i];
        const paraEnd = i < paragraphLineNumbers.length - 1
          ? paragraphLineNumbers[i + 1]
          : parsed.totalLines;

        if (line >= paraStart && line < paraEnd) {
          paragraphsToTranslate.add(i);
          break;
        }
      }
    }
  }

  // 返回需要翻译的段落
  return Array.from(paragraphsToTranslate).sort((a, b) => a - b).map(index => ({
    index,
    paragraph: paragraphs[index]
  }));
}

/**
 * 合并翻译结果到原文件结构
 *
 * @param {Object} parsed - 解析后的 MDX 内容
 * @param {Array} translatedParagraphs - 翻译后的段落列表
 * @returns {string} 完整的 MDX 文件内容
 */
function mergeTranslation(parsed, translatedParagraphs) {
  const { frontmatter, imports } = parsed;

  const parts = [];

  // 添加 frontmatter
  if (frontmatter) {
    parts.push(frontmatter);
  }

  // 添加空行分隔
  if (frontmatter && imports) {
    parts.push('');
  }

  // 添加 imports
  if (imports) {
    parts.push(imports);
    parts.push('');
  }

  // 添加翻译后的段落
  for (let i = 0; i < translatedParagraphs.length; i++) {
    parts.push(translatedParagraphs[i]);

    // 段落之间添加空行 (除了最后一个)
    if (i < translatedParagraphs.length - 1) {
      parts.push('');
    }
  }

  return parts.join('\n');
}

/**
 * 检测文本是否为代码块
 */
function isCodeBlock(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

/**
 * 检测文本是否为 JSX 标签
 */
function isJSXTag(text) {
  return /^<[A-Z][a-zA-Z]*(?:\s+[^>]*)?>/.test(text) ||
         /^<\/[A-Z][a-zA-Z]*>$/.test(text);
}

/**
 * 提取需要翻译的文本 (跳过代码块)
 */
function extractTranslatableText(paragraph) {
  const lines = paragraph.split('\n');
  const translatable = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (isCodeBlock(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!inCodeBlock && line.trim() && !isJSXTag(line)) {
      translatable.push(line);
    }
  }

  return translatable.join('\n');
}

/**
 * 批量合并段落，减少 API 请求数
 *
 * @param {Array} paragraphs - 段落数组
 * @param {number} maxChars - 每批最大字符数，默认 2000
 * @returns {Array} 批次数组，每批包含 {indices: number[], text: string}
 */
function batchParagraphs(paragraphs, maxChars = 2000) {
  const batches = [];
  let currentBatch = { indices: [], text: '' };

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const newText = currentBatch.text + (currentBatch.text ? '\n\n' : '') + para;

    // 如果加入新段落后超过阈值，且当前批次已有内容，则保存当前批次
    if (newText.length > maxChars && currentBatch.indices.length > 0) {
      batches.push(currentBatch);
      currentBatch = { indices: [i], text: para };
    } else {
      currentBatch.indices.push(i);
      currentBatch.text = newText;
    }
  }

  // 添加最后一个批次
  if (currentBatch.indices.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

module.exports = {
  parseMDX,
  extractDiffHunks,
  alignToParagraphs,
  mergeTranslation,
  isCodeBlock,
  isJSXTag,
  extractTranslatableText,
  batchParagraphs
};
