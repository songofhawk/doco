import plantumlEncoder from 'plantuml-encoder'

export type PlantUMLRenderer = (source: string, signal?: AbortSignal) => Promise<string>

export const PUBLIC_PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg'

/** 显式选择公共 PlantUML 服务时使用；纯前端组件默认不会调用它。 */
export const renderPlantUMLWithPublicServer: PlantUMLRenderer = async (source, signal) => {
    const encoded = plantumlEncoder.encode(source)
    const response = await fetch(`${PUBLIC_PLANTUML_SERVER}/${encoded}`, { signal })
    if (!response.ok) throw new Error(`PlantUML 服务返回 ${response.status}`)
    return response.text()
}
