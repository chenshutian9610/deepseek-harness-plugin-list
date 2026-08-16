window.__ModuleLoader__.load({
  id: 'deepseek-harness-web-lan-auth',
  factory: (require) => {
    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')
    const module = { exports: {} }
    const NS = 'settings.lanAuth'
    const inject = ['slots', 'locale']

    const css = '.dsh-lan-auth{display:flex;flex-direction:column;gap:10px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dsh-lan-auth__title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}.dsh-lan-auth__form{display:flex;align-items:center;gap:8px}.dsh-lan-auth__input{box-sizing:border-box;min-width:0;height:36px;flex:1;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit}.dsh-lan-auth__hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dsh-lan-auth__message{margin:0;color:var(--dsw-alias-state-success-primary,#16803c);font-size:12px}.dsh-lan-auth__message[data-error=true]{color:var(--dsw-alias-state-error-primary)}'
    if (document.querySelector('style[data-plugin="deepseek-harness-web-lan-auth"]') === null) {
      const style = document.createElement('style')
      style.dataset.plugin = 'deepseek-harness-web-lan-auth'
      style.textContent = css
      document.head.appendChild(style)
    }

    const zh = {
      title: '局域网登录密码',
      configured: '已配置。留空不会修改当前密码。',
      missing: '尚未配置；配置前局域网访问会被拒绝。',
      readonly: '密码由启动环境提供，页面不可修改。',
      placeholder: '输入新密码（至少 8 位）',
      save: '保存',
      saving: '保存中…',
      saved: '密码已更新',
      reauth: '密码已更新，正在重新登录…',
      loadFailed: '无法读取密码状态',
      saveFailed: '保存失败',
    }
    const en = {
      title: 'LAN login password',
      configured: 'Configured. Leaving this blank keeps the current password.',
      missing: 'Not configured; LAN access is denied until a password is set.',
      readonly: 'The launch environment provides this password; it cannot be changed here.',
      placeholder: 'New password (at least 8 characters)',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Password updated',
      reauth: 'Password updated. Signing in again…',
      loadFailed: 'Could not load password status',
      saveFailed: 'Could not save password',
    }

    function PasswordRow({ t }) {
      const [state, setState] = React.useState({ loading: true, configured: false, writable: false })
      const [draft, setDraft] = React.useState('')
      const [saving, setSaving] = React.useState(false)
      const [message, setMessage] = React.useState(null)

      React.useEffect(() => {
        let active = true
        fetch('/auth/password', { headers: { accept: 'application/json' } }).then(async response => {
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || t('loadFailed'))
          if (active) setState({ loading: false, configured: body.configured, writable: body.writable })
        }).catch(error => {
          if (active) {
            setState(current => ({ ...current, loading: false }))
            setMessage({ error: true, text: error instanceof Error ? error.message : t('loadFailed') })
          }
        })
        return () => { active = false }
      }, [t])

      const submit = async event => {
        event.preventDefault()
        if (draft === '') return
        setSaving(true)
        setMessage(null)
        try {
          const response = await fetch('/auth/password', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password: draft }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.error || t('saveFailed'))
          setDraft('')
          setState(current => ({ ...current, configured: true }))
          setMessage({ error: false, text: t(body.reauthenticate ? 'reauth' : 'saved') })
          if (body.reauthenticate) setTimeout(() => location.reload(), 600)
        } catch (error) {
          setMessage({ error: true, text: error instanceof Error ? error.message : t('saveFailed') })
        } finally {
          setSaving(false)
        }
      }

      const disabled = state.loading || !state.writable || saving
      const hint = state.loading ? '' : !state.writable && state.configured ? t('readonly') : state.configured ? t('configured') : t('missing')
      return jsxs('div', { className: 'dsh-lan-auth', children: [
        jsx('div', { className: 'dsh-lan-auth__title', children: t('title') }),
        jsxs('form', { className: 'dsh-lan-auth__form', onSubmit: submit, children: [
          jsx('input', {
            className: 'dsh-lan-auth__input',
            type: 'password',
            autoComplete: 'new-password',
            minLength: 8,
            maxLength: 1024,
            value: draft,
            placeholder: t('placeholder'),
            'aria-label': t('title'),
            disabled,
            onChange: event => setDraft(event.target.value),
          }),
          jsx(Button, { type: 'submit', size: 'sm', disabled: disabled || draft === '', children: saving ? t('saving') : t('save') }),
        ] }),
        jsx('p', { className: 'dsh-lan-auth__hint', children: hint }),
        message === null ? null : jsx('p', { className: 'dsh-lan-auth__message', 'data-error': message.error, role: message.error ? 'alert' : 'status', children: message.text }),
      ] })
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'lan-auth settings dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'lan-auth-password',
        order: 30,
        locale: NS,
      }, props => jsx(PasswordRow, { ...props, t })))
    }

    module.exports = { apply, inject }
    return module.exports
  },
})
