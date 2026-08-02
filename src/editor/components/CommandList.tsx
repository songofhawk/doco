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
        <div className="doco-command-menu" role="listbox" aria-label="插入内容">
            <div className="doco-command-menu-heading">基础内容</div>
            {props.items.map((item: any, index: number) => (
                <button
                    type="button"
                    className="doco-command-menu-item"
                    key={index}
                    onClick={() => selectItem(index)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    role="option"
                    aria-selected={index === selectedIndex}
                >
                    <div className="doco-command-menu-icon">
                        {item.icon && <item.icon />}
                    </div>
                    <div className="doco-command-menu-copy">
                        <span className="doco-command-menu-title">{item.title}</span>
                        <span className="doco-command-menu-description">{item.description}</span>
                    </div>
                </button>
            ))}
        </div>
    )
})

export default CommandList
