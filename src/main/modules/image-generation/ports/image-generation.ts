import type { ImageAccount, ImageBoard, ImageNode, ImageExecutionSettings, ImageOutputDiagnostics } from '../../../../shared/contracts/image-generation'
import type { Asset } from '../../../../shared/contracts/assets'

export interface ImageAccountRecord { account: ImageAccount; cipher: Uint8Array; fingerprint: string }
export interface ImageSubmissionReceipt { requestKey: string; input: string; nodeIds: string[]; createdAt: string }
export interface ImageGenerationRepository {
  accounts(): ImageAccountRecord[]
  saveAccount(record: ImageAccountRecord, expectedRevision: number): void
  boards(projectId: string | null): ImageBoard[]
  board(id: string): ImageBoard
  saveBoard(board: ImageBoard, expectedRevision: number): void
  nodes(boardId?: string): ImageNode[]
  node(id: string): ImageNode
  saveNodes(nodes: ImageNode[], expectedRevisions: number[], submission?: ImageSubmissionReceipt): void
  submission(requestKey: string): ImageSubmissionReceipt | null
  references(assetId: string): boolean
  output(id: string): Uint8Array | null
  saveOutput(id: string, cipher: Uint8Array): void
  settings(): ImageExecutionSettings
  saveSettings(settings: ImageExecutionSettings): void
}
export interface ImageCredentialVault {
  seal(value: string): { cipher: Uint8Array; fingerprint: string }
  open(cipher: Uint8Array): string
}
export interface ImageGenerationAssets {
  get(id: string): Asset
  path(id: string): string
  register(node: ImageNode, file: { storedName: string; size: number }): string
  assertProject(projectId: string | null): Promise<void>
}
export interface ImageOutput { b64_json?: string | undefined; url?: string | undefined }
export interface ImageOutputStore {
  diagnoseOutput(output: ImageOutput, trustedServiceOrigin: string | null): Promise<ImageOutputDiagnostics>
  saveOutput(nodeId: string, output: ImageOutput, signal: AbortSignal, trustedServiceOrigin?: string | null): Promise<{ storedName: string; size: number }>
}
export interface ImageProtocolCapabilities {
  id: string
  execution: 'synchronous'
  sizes: readonly ImageNode['size'][]
  maxReferences: number
  progress: 'phase'
}
export interface ImageProtocol {
  readonly capabilities: ImageProtocolCapabilities
  validate(account: ImageAccount, node: ImageNode): void
  generate(account: ImageAccount, key: string, node: ImageNode, paths: string[], signal: AbortSignal, onSending: () => void): Promise<ImageOutput>
}
export interface ImageGateway extends ImageOutputStore {
  protocols?(): ImageProtocolCapabilities[]
  validate?(account: ImageAccount, node?: ImageNode): void
  generate: ImageProtocol['generate']
}
