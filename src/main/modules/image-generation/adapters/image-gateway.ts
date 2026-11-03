import type { ImageAccount, ImageNode } from '../../../../shared/contracts/image-generation'
import type { ImageGateway, ImageOutputStore, ImageProtocol } from '../ports/image-generation'
import { ImageRequestError } from '../domain/image-errors'

export class ProtocolImageGateway implements ImageGateway {
  private readonly adapters = new Map<string, ImageProtocol>()
  constructor(protocols: readonly ImageProtocol[], private readonly outputs: ImageOutputStore) {
    for (const protocol of protocols) {
      if (this.adapters.has(protocol.capabilities.id)) throw new Error('生图协议重复注册')
      this.adapters.set(protocol.capabilities.id, protocol)
    }
  }
  protocols() {
    return [...this.adapters.values()].map(({ capabilities }) => ({ ...capabilities, sizes: [...capabilities.sizes] }))
  }
  private protocol(account: ImageAccount) {
    // 历史账号没有协议字段，沿用既有 OpenAI 图片协议，不按域名猜测或尝试其他协议。
    const protocol = this.adapters.get(account.protocol ?? 'openai-images')
    if (!protocol) throw new ImageRequestError('当前生图协议未安装，未发送请求')
    return protocol
  }
  validate(account: ImageAccount, node?: ImageNode) {
    const protocol = this.protocol(account)
    if (node) protocol.validate(account, node)
  }
  generate: ImageGateway['generate'] = (account, key, node, paths, signal, onSending) => {
    const protocol = this.protocol(account)
    protocol.validate(account, node)
    return protocol.generate(account, key, node, paths, signal, onSending)
  }
  diagnoseOutput: ImageOutputStore['diagnoseOutput'] = (output, origin) => this.outputs.diagnoseOutput(output, origin)
  saveOutput: ImageOutputStore['saveOutput'] = (id, output, signal, origin) => this.outputs.saveOutput(id, output, signal, origin)
}
