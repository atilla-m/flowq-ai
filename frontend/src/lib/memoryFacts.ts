import { deviceFromMemory } from './traceView'

/** Presentation only: extract explicit facts from the API's free-text memory, never infer them. */
export function memoryFacts(memory?: string) {
  // The API joins summaries oldest first. Prefer the newest explicit fact for each field.
  const summaries = (memory ?? '').replace(/^(?:voice|whatsapp):\s*/gm, '').replace(/\*\*/g, '').split('\n').reverse()
  const latest = <T,>(read: (summary: string) => T | undefined) => summaries.map(read).find((value) => value !== undefined)
  const interest = latest((text) => text.match(/(?:interested in|asked about|asked for|looking for|wants(?: to)?|asks for)\s+([^.!?\n]+)/i)?.[1]
    ?.replace(/^upgrading to\s+/i, '').trim())
  const district = latest((text) => text.match(/\b(?:Yasamal|Nəsimi|Nərimanov|Xətai|Binəqədi|Səbail|Sabunçu|Suraxanı|Sumqayıt|Abşeron|Qaradağ|Xəzər|Nizami)\b/iu)?.[0])
  // Only explicit ownership of a recognizable shop device, never an interest or a language preference.
  const device = latest((text) => deviceFromMemory(text) ?? text.match(/(?:uses|owns|bought)\s+(?:an?\s+)?((?:iPhone|Samsung|Galaxy|Xiaomi|Redmi|Google Pixel|MacBook|Lenovo|Asus|iPad|PlayStation|Sony|AirPods|Apple Watch|Nintendo|HP|Dell|Acer|Huawei)\b[^.;\n]*?)(?=\s+(?:previously|for|and|with|toward)\b|[.;\n]|$)/i)?.[1]?.trim())
  const order = latest((text) => {
    const match = text.match(/\border\s+([A-Z0-9]+(?:-[A-Z0-9]+)+)\b[^\n]*?\bstatus\s+([\w ]+?)(?=[.;\n]|$)/i)
    return match ? { id: match[1], status: match[2].replace(/_/g, ' ').trim() } : undefined
  })
  return {
    device,
    interest,
    district,
    order,
  }
}
