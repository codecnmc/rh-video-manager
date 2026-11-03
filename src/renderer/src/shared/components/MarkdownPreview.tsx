import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './markdown.css'

export function MarkdownPreview({ markdown }: { markdown: string }) {
  return <article className="markdown-preview"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // 预览不加载远程资源、不导航出应用，防止文档或插件文本触发联网。
    img: ({ alt }) => <span className="muted">[图片：{alt || '未命名'}]</span>,
    a: ({ children, href }) => <span className="markdown-link" title={href}>{children}</span>
  }}>{markdown}</Markdown></article>
}
