import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'

export const CommandList = forwardRef((props: any, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    const selectItem = (index: number) => {
        const item = props.items[index]
        if (item) {
            props.command(item)
        }
    }

    const upHandler = () => {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
    }

    const downHandler = () => {
        setSelectedIndex((selectedIndex + 1) % props.items.length)
    }

    const enterHandler = () => {
        selectItem(selectedIndex)
    }

    useEffect(() => setSelectedIndex(0), [props.items])

    useImperativeHandle(ref, () => ({
        onKeyDown: ({ event }: any) => {
            if (event.key === 'ArrowUp') {
                upHandler()
                return true
            }
            if (event.key === 'ArrowDown') {
                downHandler()
                return true
            }
            if (event.key === 'Enter') {
                enterHandler()
                return true
            }
            return false
        },
    }))

    if (!props.items.length) return null

    return (
        <div className="bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden w-64 flex flex-col py-2 z-50">
            <div className="text-xs text-gray-400 font-semibold px-4 pb-2">基础内容</div>
            {props.items.map((item: any, index: number) => (
                <button
                    className={`flex items-center px-4 py-2 text-sm text-left w-full transition-colors outline-none select-none
            ${index === selectedIndex ? 'bg-gray-100/80 text-blue-600' : 'text-gray-700 hover:bg-gray-50'}
          `}
                    key={index}
                    onClick={() => selectItem(index)}
                >
                    <div className="flex items-center justify-center w-8 h-8 rounded shrink-0 bg-white border border-gray-200 mr-3">
                        {item.icon && <item.icon className="w-4 h-4 text-gray-600" />}
                    </div>
                    <div className="flex flex-col">
                        <span className="font-medium text-gray-800">{item.title}</span>
                        <span className="text-xs text-gray-500">{item.description}</span>
                    </div>
                </button>
            ))}
        </div>
    )
})

export default CommandList
