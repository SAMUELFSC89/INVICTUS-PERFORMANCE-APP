from pathlib import Path

profile = Path('src/pages/ProfileNew.tsx')
text = profile.read_text(encoding='utf-8')
old_import = "import { ArrowRight, Bell, Brain, Camera, CheckCircle2, Clock, Dumbbell, Flame, HeartPulse, HelpCircle, ImagePlus, Landmark, Medal, Plus, Settings, ShieldCheck, Store, Trash2, Trophy, UserRound, Watch, X } from 'lucide-react';"
new_import = "import { ArrowRight, Bell, Brain, Camera, CheckCircle2, Clock, Crown, Dumbbell, Flame, HeartPulse, HelpCircle, ImagePlus, Landmark, Medal, Plus, Settings, ShieldCheck, Store, Trash2, Trophy, UserRound, Watch, X } from 'lucide-react';"
assert old_import in text, 'ProfileNew import anchor not found'
text = text.replace(old_import, new_import, 1)
old_menu = "<div className=\"np-section-head\"><h2>CONFIGURAÇÕES</h2></div><section className=\"np-menu\"><button onClick={() => navigate('/profile/preferences')}><UserRound /><span>Minha conta</span></button>"
new_menu = "<div className=\"np-section-head\"><h2>CONFIGURAÇÕES</h2></div><section className=\"np-menu\"><button className=\"np-menu-pro\" onClick={() => navigate('/profile/preferences/subscriptions', { state: { returnTo: '/profile' } })}><Crown /><span>{paid ? 'Assinatura PRO' : 'Virar PRO'}</span></button><button onClick={() => navigate('/profile/preferences')}><UserRound /><span>Minha conta</span></button>"
assert old_menu in text, 'Profile menu anchor not found'
text = text.replace(old_menu, new_menu, 1)
profile.write_text(text, encoding='utf-8')

manager = Path('src/components/SubscriptionManager.tsx')
text = manager.read_text(encoding='utf-8')
old = "<p>Gráficos biométricos avançados, integrações de saúde e recursos de IA. A assinatura não altera pontos nem inscreve você automaticamente em competições.</p>"
new = """<p>Desbloqueie a experiência completa do Invictus Performance. A assinatura não altera seus pontos e não inscreve você automaticamente em competições.</p>\n      <ul className=\"subscription-manager-benefits\" aria-label=\"Benefícios do plano Pro\">\n        <li><CheckCircle2 /><span><b>Saúde avançada</b><small>Métricas biométricas, zonas cardíacas e análises detalhadas.</small></span></li>\n        <li><CheckCircle2 /><span><b>Integrações de saúde</b><small>Apple Health, Health Connect e Strava integrados ao seu acompanhamento.</small></span></li>\n        <li><CheckCircle2 /><span><b>Invictus IA</b><small>Insights e recomendações personalizados com base na sua evolução.</small></span></li>\n        <li><CheckCircle2 /><span><b>Relatórios completos</b><small>Visão avançada do seu histórico e desempenho para acompanhar sua evolução.</small></span></li>\n      </ul>"""
assert old in text, 'Subscription description anchor not found'
text = text.replace(old, new, 1)
manager.write_text(text, encoding='utf-8')

css = Path('src/pages/ProfileSecondary.css')
style = """\n.subscription-manager-benefits{display:grid;gap:.5rem;margin:0;padding:0;list-style:none}.subscription-manager-benefits li{display:flex;gap:.55rem;align-items:flex-start;padding:.62rem .68rem;border:1px solid rgba(242,181,22,.16);border-radius:.48rem;background:rgba(255,255,255,.025)}.subscription-manager-benefits li>svg{flex:none;width:1rem;height:1rem;margin-top:.05rem;color:#f2b516}.subscription-manager-benefits li>span{display:grid;gap:.12rem}.subscription-manager-benefits b{color:#fff;font-size:.7rem}.subscription-manager-benefits small{color:#aaa69d;font-size:.63rem;line-height:1.35}\n"""
current = css.read_text(encoding='utf-8')
if '.subscription-manager-benefits{' not in current:
    css.write_text(current + style, encoding='utf-8')

profile_css = Path('src/pages/ProfileNew.css')
current = profile_css.read_text(encoding='utf-8')
style2 = """\n.np-menu .np-menu-pro{border-color:rgba(242,181,22,.5);color:#f2b516;background:linear-gradient(135deg,rgba(242,181,22,.12),rgba(8,8,8,.95))}.np-menu .np-menu-pro svg{color:#f2b516}\n"""
if '.np-menu .np-menu-pro{' not in current:
    profile_css.write_text(current + style2, encoding='utf-8')

print('Profile PRO subscription entry applied')
