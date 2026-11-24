export interface Tile {
  center: [number, number, number]
  centroid: [number, number, number]
  half: number
  count: number
  subtreeCount: number
  children: string[]
  mMin: number
  lSum: number
  lSum0: number
  meanBpRp: number
  meanLogTeff0: number
  url: string
  survey: string
}
export interface Hierarchy {
  roots: string[]
  nodes: Record<string, Tile>
}

export async function loadHierarchy(base: string): Promise<Hierarchy | null> {
  const tree: Hierarchy = { roots: [], nodes: {} }
  await Promise.all(
    ["stars", "lmc", "deep", "deep-wide", "luminous"].map(async (survey) => {
      const folder = base + "tiles/" + survey + "/"
      const response = await fetch(folder + "hierarchy.json")
      if (response.status === 404) return
      if (!response.ok) throw Error(`Hierarchy ${survey}: HTTP ${response.status}`)
      // Some static dev servers answer missing JSON requests with the HTML entry point.
      if (response.headers.get("content-type")?.includes("text/html")) return
      const raw = await response.json()
      if (raw.format !== (survey.startsWith("deep") || survey === "luminous" ? "GDI1" : "STN1") || raw.version !== 1 || !raw.nodes?.[raw.root])
        throw Error("Invalid tile hierarchy: " + survey)
      const origin: number[] = raw.origin ?? [0, 0, 0]
      for (const [id, tile] of Object.entries(raw.nodes) as [string, Tile][]) {
        for (let i = 0; i < 3; i++) {
          tile.center[i] += origin[i]
          tile.centroid[i] += origin[i]
        }
        tree.nodes[survey + "/" + id] = {
          ...tile,
          survey,
          url: new URL(folder + id + ".bin", document.baseURI).href,
          children: tile.children.map((c) => survey + "/" + c),
        }
      }
      tree.roots.push(survey + "/" + raw.root)
    }),
  )
  return tree.roots.length ? tree : null
}
