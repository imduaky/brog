import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SiteSettings } from '@shared/types'
import { ColorPairField } from '@/components/color-field'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { THEME_PRESETS } from '@shared/color'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

/** Colors of the reading paper and the home page, each in a light and a dark variant. */
export function AppearanceCard({ settings }: { settings: SiteSettings }) {
  const qc = useQueryClient()
  const [paper, setPaper] = useState(settings.paper)
  const [homeColor, setHomeColor] = useState(settings.home.color)
  const dirty = JSON.stringify([paper, homeColor]) !== JSON.stringify([settings.paper, settings.home.color])

  const save = useMutation({
    mutationFn: () =>
      api<SiteSettings>('/api/admin/site-settings', {
        method: 'PUT',
        json: { ...settings, paper, home: { ...settings.home, color: homeColor } },
      }),
    onSuccess: () => {
      toast.success('外观已保存')
      void qc.invalidateQueries({ queryKey: ['site'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>外观</CardTitle>
        <CardDescription>亮色和暗色分别设置。阅读底色用于所有页面，首页颜色只用于首页。</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8">
        <ColorPairField
          idPrefix="paper"
          label="阅读底色（全站）"
          value={paper}
          onChange={setPaper}
          presets={[
            { name: '米黄（默认）', pair: { light: '#f4ecd8', dark: '#1f1c17' } },
            { name: '纯白', pair: { light: '#ffffff', dark: '#161616' } },
            ...THEME_PRESETS.slice(0, 2),
          ]}
        />
        <div className="grid gap-5 border-t pt-6">
          <ColorPairField idPrefix="home" label="首页背景" value={homeColor} onChange={setHomeColor} />
        </div>
        <div className="flex justify-end border-t pt-5">
          <Button onClick={() => save.mutate(undefined)} disabled={!dirty || save.isPending}>
            保存外观
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
