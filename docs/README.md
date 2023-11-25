# Qwik Docs 网站 ⚡️ 中文

## 开发构建

### 仅客户端

在开发过程中，index.html 不是服务器端渲染的结果，而是使用客户端 JavaScript 构建的 Qwik 应用程序。这对于使用 Vite 进行开发非常理想，因为它可以快速和按需重新加载模块。然而，这种模式仅用于开发，不展示 Qwik 的工作原理，因为需要执行 JavaScript，并且 Vite 导入了许多开发模块供应用程序使用。

```
pnpm dev
```

### 服务器端渲染 (SSR) 和客户端

服务器端渲染的 index.html，浏览器预取和加载客户端模块。这可以用于在开发过程中测试服务器端渲染的内容，但比仅客户端的开发构建速度较慢。

```
pnpm dev.ssr
```

## 生产构建

生产构建应通过运行客户端和服务器构建命令来生成客户端和服务器模块。

```
pnpm build
```

### 客户端模块

仅创建由浏览器动态导入的客户端模块的生产构建。

```
pnpm build.client
```

### 服务器模块

创建用于服务器渲染 HTML 的服务器端渲染 (SSR) 模块的生产构建。

```
pnpm build.ssr
```

## Cloudflare Pages

可以使用 Cloudflare 的 [wrangler](https://github.com/cloudflare/wrangler) CLI 在本地预览生产构建。要启动本地服务器，请运行：

```
pnpm serve
```

然后访问 [http://localhost:8787/](http://localhost:8787/)

### 部署

[Cloudflare Pages](https://pages.cloudflare.com/) 可以通过其 [Git 提供商集成](https://developers.cloudflare.com/pages/platform/git-integration/) 进行部署。

如果您还没有帐户，请在此处 [创建 Cloudflare 帐户](https://dash.cloudflare.com/sign-up/pages)。然后转到您的仪表板，按照 [Cloudflare Pages 部署指南](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/) 进行操作。

在项目的 "设置" 中的 "构建和部署" 中，"构建命令" 应为 `pnpm build`，"构建输出目录" 应设置为 `dist`。

## Algolia 搜索

仍在进行中

资源：https://docsearch.algolia.com/

### 爬虫

在 https://crawler.algolia.com/ 进行设置

### 使用爬虫设置调试本地站点

为了测试内容层次结构的索引设置，可以爬取本地站点。使用以下 Docker 命令：

```shell
# 通过 https://www.algolia.com/account/api-keys 创建 apiKey
touch .env
# APPLICATION_ID=APPLICATION_ID
# API_KEY=API_KEY
docker run -it --rm --env-file=.env -e "CONFIG=$(cat ./packages/docs/algolia.json | jq -r tostring)" algolia/docsearch-scraper
```

参见 [DocSearch-legacy Docker 命令指南](https://docsearch.algolia.com/docs/legacy/run-your-own#run-the-crawl-from-the-docker-image)

> 在 Mac 机器上，Docker 容器可以访问主机的网络，解决方法是使用 `host.docker.internal`

## Cloudflare Pages

可以使用 Cloudflare 的 [wrangler](https://github.com/cloudflare/wrangler) CLI 在本地预览生产构建。要启动本地服务器，请运行：

```
pnpm serve
```

然后访问 [http://localhost:8787/](http://localhost:8787/)

### 部署

[Cloudflare Pages](https://pages.cloudflare.com/) 可以通过其 [Git 提供商集成](https://developers.cloudflare.com/pages/platform/git-integration/) 进行部署。

如果您还没有帐户，请在此处 [创建 Cloudflare 帐户](https://dash.cloudflare.com/sign-up/pages)。然后转到您的仪表板，按照 [Cloudflare Pages 部署指南](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/) 进行操作。

在项目的 "设置" 中的 "构建和部署" 中，"构建命令" 应为 `pnpm build`，"构建输出目录" 应设置为 `dist`。

### 函数调用路由

Cloudflare Pages 的 [函数调用路由配置](https://developers.cloudflare.com/pages/platform/functions/routing/#functions-invocation-routes) 可用于包含或排除某些路径供工作器函数使用。通过提供 `_routes.json` 文件，开发人员可以更精细地控制何时调用函数。这对于确定页面响应是否应该进行服务器端渲染 (SSR)，还是使用静态站点生成 (SSG) 的 `index.html` 文件非常有用。

默认情况下，Cloudflare Pages 适配器 _不会_ 包含 `public/_routes.json` 配置，而是由 Cloudflare 适配器根据构建自动生成。一个自动生成的 `dist/_routes.json` 的示例可能是：

```
{
  "include": [
    "/*"
  ],
  "exclude": [
    "/_headers",
    "/_redirects",
    "/build/*",
    "/favicon.ico",
    "/manifest.json",
    "/service-worker.js",
    "/about"
  ],
  "version": 1
}
```

在上面的示例中，它表示 _所有_ 页面都应该进行 SSR。然而，根目录的静态文件，如 `/favicon.ico` 和 `/build/*` 中的任何静态资源，应该从函数中排除，而是作为静态文件处理。

在大多数情况下，生成的 `dist/_routes.json` 文件是理想的。然而，如果您需要对每个路径进行更精细的控制，可以提供自己的 `public/_routes.json` 文件。当项目提供自己的 `public/_routes.json` 文件时，Cloudflare 适配器将不会自动生成路由配置，而是使用 `public` 目录中提交的配置。
