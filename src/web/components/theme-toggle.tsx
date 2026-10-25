import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { type Theme, useTheme } from '@/hooks/use-theme'

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }
const LABEL: Record<Theme, string> = { system: '跟随系统', light: '浅色', dark: '深色' }

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" onClick={() => setTheme(NEXT[theme])} aria-label={`主题：${LABEL[theme]}`}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>主题：{LABEL[theme]}</TooltipContent>
    </Tooltip>
  )
}
