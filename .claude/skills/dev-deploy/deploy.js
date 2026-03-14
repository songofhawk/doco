#!/usr/bin/env node
/**
 * Dev & Deploy - 一站式 Web 应用开发部署工具
 * 
 * 完整流程：创建项目 → 编码 → GitHub → Cloudflare → 测试
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execSync, execFileSync } = require('child_process');

// 配置
const DEFAULTS = {
  projectsDir: path.join(os.homedir(), 'projects'),
  testDelay: 5000,
  maxRetries: 3,
  defaultDomain: 'pages.dev',
  defaultBranch: 'main',
  pagesBuildOutputDir: '.'
};

let CONFIG = null;

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, type = 'info') {
  const prefix = {
    info: `${colors.blue}[i]${colors.reset}`,
    success: `${colors.green}[+]${colors.reset}`,
    error: `${colors.red}[x]${colors.reset}`,
    warning: `${colors.yellow}[!]${colors.reset}`,
    step: `${colors.cyan}=>${colors.reset}`
  }[type] || '[i]';
  
  console.log(`${prefix} ${message}`);
}

function error(message) {
  log(message, 'error');
  process.exit(1);
}

function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    error(`配置文件读取失败: ${filePath} (${e.message})`);
  }
}

function loadConfig(configPath) {
  const candidates = [];
  if (configPath) candidates.push(expandHome(configPath));
  if (process.env.DEV_DEPLOY_CONFIG) candidates.push(expandHome(process.env.DEV_DEPLOY_CONFIG));

  const xdg = process.env.XDG_CONFIG_HOME
    ? expandHome(process.env.XDG_CONFIG_HOME)
    : path.join(os.homedir(), '.config');
  candidates.push(path.join(xdg, 'dev-deploy', 'config.json'));
  candidates.push(path.join(os.homedir(), '.dev-deploy.json'));

  for (const filePath of candidates) {
    if (filePath && fs.existsSync(filePath)) {
      return readJsonFile(filePath);
    }
  }

  return {};
}

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveConfig(options) {
  const fileConfig = loadConfig(options.configPath);

  const config = {
    projectsDir:
      options.projectsDir ||
      process.env.PROJECTS_DIR ||
      fileConfig.projectsDir ||
      DEFAULTS.projectsDir,
    cloudflareToken:
      process.env.CLOUDFLARE_API_TOKEN ||
      fileConfig.cloudflareApiToken ||
      fileConfig.cloudflareToken ||
      null,
    testDelay: parseNumber(process.env.TEST_DELAY ?? fileConfig.testDelay, DEFAULTS.testDelay),
    maxRetries: parseNumber(process.env.MAX_RETRIES ?? fileConfig.maxRetries, DEFAULTS.maxRetries),
    defaultDomain:
      process.env.DEFAULT_DOMAIN || fileConfig.defaultDomain || DEFAULTS.defaultDomain,
    defaultBranch:
      process.env.DEFAULT_BRANCH || fileConfig.defaultBranch || DEFAULTS.defaultBranch,
    pagesBuildOutputDir:
      process.env.PAGES_BUILD_OUTPUT_DIR ||
      fileConfig.pagesBuildOutputDir ||
      DEFAULTS.pagesBuildOutputDir
  };

  config.projectsDir = path.resolve(expandHome(config.projectsDir));
  config.pagesBuildOutputDir = config.pagesBuildOutputDir || '.';
  return config;
}

function ensureNodeVersion(requiredMajor) {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < requiredMajor) {
    error(`需要 Node.js ${requiredMajor}+，当前版本为 ${process.versions.node}`);
  }
}

function checkCommand(command, name, hint) {
  try {
    execSync(command, { stdio: 'pipe' });
    log(`${name} 已安装`, 'success');
    return true;
  } catch (e) {
    error(hint);
  }
}

function toSlug(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .replace(/-+/g, '-');
}

function validateProjectName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) {
    error('项目名称不能为空');
  }

  const slug = toSlug(trimmed);
  const isValid = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(trimmed);
  if (!isValid || trimmed !== slug) {
    error(`项目名称需要使用小写字母、数字和短横线，建议名称: ${slug || 'my-app'}`);
  }
}

function getCurrentBranch() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    return branch === 'HEAD' ? null : branch;
  } catch (e) {
    return null;
  }
}

function hasCommits() {
  try {
    execSync('git rev-parse --verify HEAD', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

function hasUncommittedChanges() {
  try {
    const status = execSync('git status --porcelain', {
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    return status.length > 0;
  } catch (e) {
    return false;
  }
}

function getGitRemoteUrl() {
  try {
    return execSync('git remote get-url origin', {
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
  } catch (e) {
    return null;
  }
}

function pushToRemote(branch) {
  if (!hasCommits()) {
    error('当前仓库没有提交，无法推送到远程仓库');
  }
  execFileSync('git', ['push', '-u', 'origin', branch], { stdio: 'inherit' });
}

function waitForEnter(message) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

function copyDir(sourcePath, targetPath) {
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    filter: src => {
      const base = path.basename(src);
      if (base === '.git') return false;
      return true;
    }
  });
}

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    name: null,
    custom: false,
    source: null,
    public: false,
    skipTest: false,
    projectsDir: null,
    configPath: null,
    branch: null,
    skipGithub: false,
    skipDeploy: false,
    inPlace: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--name':
        options.name = args[++i];
        break;
      case '--template':
        error('模板能力已移除，请使用 --custom 或 --source');
        break;
      case '--custom':
        options.custom = true;
        break;
      case '--source':
        options.source = args[++i];
        break;
      case '--projects-dir':
        options.projectsDir = args[++i];
        break;
      case '--config':
        options.configPath = args[++i];
        break;
      case '--branch':
        options.branch = args[++i];
        break;
      case '--public':
        options.public = true;
        break;
      case '--skip-test':
        options.skipTest = true;
        break;
      case '--skip-github':
      case '--no-github':
        options.skipGithub = true;
        break;
      case '--skip-deploy':
      case '--no-deploy':
        options.skipDeploy = true;
        break;
      case '--in-place':
        options.inPlace = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
    }
  }

  if (!options.name) {
    error('请提供项目名称：--name <project-name>');
  }

  if (options.inPlace && !options.source) {
    error('--in-place 需要配合 --source 使用');
  }

  if (options.source && options.custom) {
    error('--source 不能与 --custom 同时使用');
  }

  return options;
}

function showHelp() {
  console.log(`
Dev & Deploy - 快速开发部署 Web 应用

用法:
  node deploy.js --name <project-name> [选项]

选项:
  --name <name>       项目名称（必填）
  --custom            自定义开发模式
  --source <path>     部署已有项目目录
  --in-place          使用已有目录原地部署（不复制）
  --projects-dir <p>  项目默认创建目录
  --config <path>     指定配置文件路径
  --branch <name>     指定 Git 分支名
  --public            创建公开仓库（默认私有）
  --skip-test         跳过访问测试
  --skip-github       跳过 GitHub 仓库创建和推送
  --skip-deploy       跳过 Cloudflare 部署
  --help, -h          显示帮助

示例:
  node deploy.js --name my-app --custom
  node deploy.js --name my-app --source ./existing-project
`);
}

// 检查前置条件
function checkPrerequisites(options, config) {
  log('检查前置条件...', 'step');

  ensureNodeVersion(18);

  checkCommand('git --version', 'Git', '未找到 Git，请先安装 Git');

  if (!options.skipGithub) {
    checkCommand('gh --version', 'GitHub CLI', '未找到 GitHub CLI，请先安装 gh');
    try {
      execSync('gh auth status', { stdio: 'pipe' });
      log('GitHub CLI 已登录', 'success');
    } catch (e) {
      error('GitHub CLI 未登录，请先运行：gh auth login');
    }
  } else {
    log('已跳过 GitHub 检查', 'warning');
  }

  if (!options.skipDeploy) {
    checkCommand('wrangler --version', 'Wrangler CLI', '未找到 Wrangler，请先安装 wrangler');
    if (config.cloudflareToken) {
      log('Cloudflare API Token 已配置', 'success');
    } else {
      try {
        execSync('wrangler whoami', { stdio: 'pipe' });
        log('Wrangler 已登录', 'success');
      } catch (e) {
        error('未检测到 Cloudflare 登录或 Token，请设置 CLOUDFLARE_API_TOKEN 或执行 wrangler login');
      }
    }
  } else {
    log('已跳过 Cloudflare 检查', 'warning');
  }

  if (options.source) {
    const sourcePath = path.resolve(options.source);
    if (!fs.existsSync(sourcePath)) {
      error(`源目录不存在: ${sourcePath}`);
    }
  }

  if (!options.inPlace) {
    try {
      fs.mkdirSync(config.projectsDir, { recursive: true });
    } catch (e) {
      error(`无法创建项目目录: ${config.projectsDir}`);
    }
  }
}

// 步骤 1: 创建项目目录
function createProject(name, config) {
  log('创建项目目录...', 'step');

  const projectPath = path.join(config.projectsDir, name);

  if (fs.existsSync(projectPath)) {
    const stat = fs.lstatSync(projectPath);
    if (!stat.isDirectory()) {
      error(`目标路径不是目录: ${projectPath}`);
    }
    log(`目录已存在: ${projectPath}`, 'warning');
    return projectPath;
  }

  fs.mkdirSync(projectPath, { recursive: true });
  log(`创建目录: ${projectPath}`, 'success');

  return projectPath;
}

// 步骤 2: 生成代码
async function generateCode(projectPath, options, sourcePath) {
  log('生成代码...', 'step');

  if (sourcePath) {
    if (sourcePath === projectPath) {
      log(`使用已有项目目录: ${sourcePath}`, 'success');
      return;
    }

    copyDir(sourcePath, projectPath);
    log('复制已有项目', 'success');
    return;
  }

  if (options.custom) {
    log('自定义开发模式 - 等待用户输入需求...', 'info');
    await waitForEnter('请手动添加代码到项目目录，然后按 Enter 继续...');
  } else {
    // 创建基础 HTML 文件
    createBasicHtml(projectPath, options.name);
    log('创建基础 HTML 项目', 'success');
  }
}

// 创建基础 HTML
function createBasicHtml(projectPath, name) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
        }
        h1 { color: #333; margin-bottom: 20px; }
        p { color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${name}</h1>
        <p>部署成功</p>
    </div>
</body>
</html>`;

  fs.writeFileSync(path.join(projectPath, 'index.html'), html);
  
  const readme = `# ${name}\n\nDeployed with Dev & Deploy\n`;
  fs.writeFileSync(path.join(projectPath, 'README.md'), readme);
}

// 步骤 3: Git 初始化
function initGit(projectPath, branch) {
  log('Git 初始化...', 'step');

  process.chdir(projectPath);

  const gitDir = path.join(projectPath, '.git');
  if (fs.existsSync(gitDir)) {
    log('检测到已有 Git 仓库，跳过初始化', 'info');
    return getCurrentBranch() || branch;
  }

  try {
    execFileSync('git', ['init', '-b', branch], { stdio: 'pipe' });
    execSync('git add .', { stdio: 'pipe' });
    if (hasUncommittedChanges()) {
      execSync('git commit -m "Initial commit"', { stdio: 'pipe' });
    }
    log('Git 初始化完成', 'success');
    return branch;
  } catch (e) {
    error(`Git 初始化失败: ${e.message}`);
  }
}

// 步骤 4: 创建 GitHub 仓库
function createGitHubRepo(name, isPublic, branch, options) {
  if (options.skipGithub) {
    log('跳过 GitHub 仓库创建和推送', 'warning');
    return null;
  }

  log('创建 GitHub 仓库...', 'step');

  const existingRemote = getGitRemoteUrl();
  if (existingRemote) {
    log('检测到已有远程仓库，执行推送', 'info');
    pushToRemote(branch);
    return existingRemote;
  }

  try {
    const visibility = isPublic ? '--public' : '--private';
    execFileSync('gh', ['repo', 'create', name, visibility, '--source=.', '--push'], { stdio: 'inherit' });
    log('GitHub 仓库创建成功', 'success');

    return getGitRemoteUrl();
  } catch (e) {
    error(`创建 GitHub 仓库失败: ${e.message}`);
  }
}

// 步骤 5: 部署到 Cloudflare
async function deployToCloudflare(name, projectPath, branch, config, options) {
  if (options.skipDeploy) {
    log('跳过 Cloudflare 部署', 'warning');
    return { deployUrl: null, projectUrl: null };
  }

  log('部署到 Cloudflare...', 'step');

  if (config.cloudflareToken) {
    process.env.CLOUDFLARE_API_TOKEN = config.cloudflareToken;
  }
  process.chdir(projectPath);

  const buildOutputDir = config.pagesBuildOutputDir || '.';
  const buildPath = path.resolve(projectPath, buildOutputDir);
  if (!fs.existsSync(buildPath)) {
    error(`构建输出目录不存在: ${buildPath}`);
  }

  // 创建 wrangler.toml（如不存在）
  const wranglerPath = path.join(projectPath, 'wrangler.toml');
  if (!fs.existsSync(wranglerPath)) {
    const wranglerConfig = `name = "${name}"
compatibility_date = "${new Date().toISOString().split('T')[0]}"

[site]
bucket = "${buildOutputDir}"
pages_build_output_dir = "${buildOutputDir}"
`;
    fs.writeFileSync(wranglerPath, wranglerConfig);
  } else {
    log('检测到 wrangler.toml，跳过自动生成', 'info');
  }

  // 创建 Pages 项目
  try {
    execFileSync('wrangler', ['pages', 'project', 'create', name, `--production-branch=${branch}`], {
      stdio: 'pipe',
      env: { ...process.env }
    });
  } catch (e) {
    log('Pages 项目可能已存在，继续部署', 'warning');
  }

  // 部署
  try {
    const output = execFileSync(
      'wrangler',
      ['pages', 'deploy', buildOutputDir, `--project-name=${name}`, `--branch=${branch}`],
      {
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env }
      }
    );

    // 解析部署 URL
    const urlMatch = output.match(/https:\/\/[^\s]+\.pages\.dev/);
    const deployUrl = urlMatch ? urlMatch[0] : null;

    // 获取项目 URL
    const projectUrl = `https://${name}.${config.defaultDomain}`;

    log('Cloudflare 部署完成', 'success');
    return { deployUrl: deployUrl || projectUrl, projectUrl };
  } catch (e) {
    error(`Cloudflare 部署失败: ${e.message}`);
  }
}

// 步骤 6: 设置自动部署
function showAutoDeployGuidance(options) {
  log('自动部署提示...', 'step');

  if (options.skipGithub || options.skipDeploy) {
    log('未同时启用 GitHub 和 Cloudflare，跳过自动部署说明', 'warning');
    return;
  }

  log('当前脚本使用 wrangler 直接部署，不会自动关联 GitHub', 'info');
  log('如需 Push 即自动部署，请在 Cloudflare Pages 控制台中连接 GitHub 仓库', 'info');
}

// 步骤 7: 访问测试
async function testDeployment(url, config) {
  log('访问测试...', 'step');

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const waitMs = config.testDelay;
    log(`等待 ${waitMs / 1000} 秒让部署生效（第 ${attempt}/${config.maxRetries} 次）...`, 'info');
    await new Promise(resolve => setTimeout(resolve, waitMs));

    try {
      const response = await fetch(url);
      if (response.ok) {
        log(`访问测试通过: ${url}`, 'success');
        return true;
      }

      log(`HTTP 错误: ${response.status}`, 'warning');
    } catch (e) {
      log(`访问失败: ${e.message}`, 'warning');
    }
  }

  log('访问测试失败，已达到最大重试次数', 'error');
  return false;
}

// 步骤 8: 问题修复
async function fixIssues(projectPath, options) {
  log('检查并修复问题...', 'step');
  
  // 这里可以添加自动修复逻辑
  // 例如：检查 index.html 是否存在，检查资源路径等
  
  const indexPath = path.join(projectPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    log('未找到 index.html，创建默认页面...', 'warning');
    createBasicHtml(projectPath, options.name);
    
    // 重新提交和部署
    if (options.skipGithub) {
      log('已修复本地文件，但跳过 GitHub 提交和推送', 'warning');
      return;
    }

    process.chdir(projectPath);
    execSync('git add .', { stdio: 'pipe' });
    if (hasUncommittedChanges()) {
      execSync('git commit -m "Fix: Add index.html"', { stdio: 'pipe' });
    }
    if (!getGitRemoteUrl()) {
      log('未检测到远程仓库，跳过推送', 'warning');
      return;
    }
    pushToRemote(getCurrentBranch() || CONFIG.defaultBranch);
    log('已修复并推送', 'success');
  } else {
    log('项目检查通过', 'success');
  }
}

// 显示部署结果
function showResults(results, options) {
  console.log('\n' + '='.repeat(50));
  log('部署完成', 'success');
  console.log('='.repeat(50));

  const githubUrl = results.githubUrl || '未创建';
  const deployUrl = results.deployUrl || '未部署';
  const autoDeploy = options.skipGithub || options.skipDeploy ? '未启用' : '需要在控制台连接 GitHub';

  console.log(`
本地路径:     ${results.projectPath}
GitHub 仓库:  ${githubUrl}
在线访问:     ${deployUrl}
自动部署:     ${autoDeploy}

后续修改:
  cd ${results.projectPath}
  # 修改代码...
  git add . && git commit -m "update" && git push
  # Cloudflare Pages 部署可手动执行或配置自动部署
`);
}

// 主函数
async function main() {
  console.log('\nDev & Deploy - 快速开发部署\n');

  const options = parseArgs();
  CONFIG = resolveConfig(options);
  validateProjectName(options.name);
  const startTime = Date.now();
  
  // 检查前置条件
  checkPrerequisites(options, CONFIG);
  
  // 执行部署流程
  const sourcePath = options.source ? path.resolve(options.source) : null;
  const projectPath = options.inPlace && sourcePath
    ? sourcePath
    : createProject(options.name, CONFIG);

  await generateCode(projectPath, options, sourcePath);

  const initialBranch = options.branch || CONFIG.defaultBranch;
  const branch = initGit(projectPath, initialBranch) || initialBranch;

  const githubUrl = createGitHubRepo(options.name, options.public, branch, options);
  const { deployUrl } = await deployToCloudflare(options.name, projectPath, branch, CONFIG, options);
  showAutoDeployGuidance(options);
  
  // 访问测试
  let testPassed = false;
  if (!options.skipTest && deployUrl && !options.skipDeploy) {
    testPassed = await testDeployment(deployUrl, CONFIG);
  }
  
  // 如有问题自动修复
  if (!testPassed && !options.skipTest && !options.skipDeploy) {
    await fixIssues(projectPath, options);
    // 重新测试
    if (deployUrl) {
      testPassed = await testDeployment(deployUrl, CONFIG);
    }
  }
  
  // 显示结果
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  showResults({
    projectPath,
    githubUrl,
    deployUrl
  }, options);
  
  log(`总耗时: ${duration} 秒`, 'info');
}

// 运行
main().catch(e => {
  error(`执行失败: ${e.message}`);
});
