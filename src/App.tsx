import { startTransition, useEffect, useEffectEvent, useState, type FormEvent } from 'react'
import logoWordmark from './assets/logo-wordmark.png'
import type {
  AppOperationResponse,
  AppState,
  ClientInput,
  ClientRecord,
  ClientStatus,
  EmailTemplate,
  SettingsInput,
  SettingsState,
} from './types'
import { webApp } from './webApp'
import './App.css'

const MAX_CONTACTS = 4
const DEFAULT_SCHEDULE_TIMES = ['09:00', '11:00', '14:00', '16:00']
const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

type Notice = {
  tone: 'error' | 'info' | 'success'
  message: string
}

type SettingsFormState = {
  autoOpenDraftOnCreate: boolean
  fromEmail: string
  fromName: string
  intervalDays: string
  templates: EmailTemplate[]
}

function createInitialClientForm(): ClientInput {
  return {
    company: '',
    email: '',
    name: '',
    notes: '',
    targetContacts: 4,
    contactScheduleTimes: [...DEFAULT_SCHEDULE_TIMES],
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocurrio un error inesperado.'
}

function formatDateTime(isoDate: string | null) {
  if (!isoDate) {
    return 'Pendiente'
  }

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoDate))
}

function formatRelativeDue(isoDate: string | null) {
  if (!isoDate) {
    return 'Sin programar'
  }

  const diffMs = new Date(isoDate).getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)
  const diffHours = Math.round(diffMs / 3_600_000)
  const diffDays = Math.round(diffMs / 86_400_000)

  if (Math.abs(diffMinutes) < 60) {
    return relativeTime.format(diffMinutes, 'minute')
  }

  if (Math.abs(diffHours) < 48) {
    return relativeTime.format(diffHours, 'hour')
  }

  return relativeTime.format(diffDays, 'day')
}

function getClientStatusLabel(status: ClientStatus) {
  if (status === 'finished') {
    return 'Finalizado'
  }

  if (status === 'canceled') {
    return 'Detenido'
  }

  return 'Activo'
}

function getClientStageLabel(client: ClientRecord) {
  return `${client.sentContacts}/${client.targetContacts} contactos avanzados`
}

function createAttemptStatuses(client: ClientRecord) {
  return Array.from({ length: client.targetContacts }, (_, index) => {
    const contactNumber = index + 1

    if (client.status === 'finished' || contactNumber <= client.sentContacts) {
      return 'done'
    }

    if (client.status === 'active' && contactNumber === client.sentContacts + 1) {
      return 'current'
    }

    if (client.status === 'canceled') {
      return 'stopped'
    }

    return 'upcoming'
  })
}

function mapSettingsToForm(settings: SettingsState): SettingsFormState {
  return {
    autoOpenDraftOnCreate: settings.automation.autoOpenDraftOnCreate,
    fromEmail: settings.sender.fromEmail,
    fromName: settings.sender.fromName,
    intervalDays: String(settings.automation.intervalDays),
    templates: settings.templates.map((template) => ({ ...template })),
  }
}

const templateTokens = [
  '{{name}}',
  '{{company}}',
  '{{companyOrName}}',
  '{{contactNumber}}',
  '{{maxContacts}}',
  '{{fromName}}',
  '{{fromEmail}}',
  '{{notes}}',
  '{{scheduledDate}}',
  '{{scheduledTime}}',
]

function App() {
  const [appState, setAppState] = useState<AppState | null>(null)
  const [clientForm, setClientForm] = useState<ClientInput>(() => createInitialClientForm())
  const [settingsForm, setSettingsForm] = useState<SettingsFormState | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [isSubmittingClient, setIsSubmittingClient] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isProcessingQueue, setIsProcessingQueue] = useState(false)
  const [busyClientId, setBusyClientId] = useState<string | null>(null)

  function applyAppState(nextState: AppState, syncSettings: boolean) {
    startTransition(() => {
      setAppState(nextState)
    })

    if (syncSettings) {
      setSettingsForm(mapSettingsToForm(nextState.settings))
    }
  }

  function applyOperationResponse(response: AppOperationResponse, syncSettings: boolean) {
    applyAppState(response, syncSettings)

    if (response.result?.message) {
      setNotice({
        tone: response.result.failed > 0 ? 'error' : 'success',
        message: response.result.message,
      })
    }
  }

  const refreshState = useEffectEvent(async (syncSettings = false) => {
    try {
      const nextState = await webApp.getAppState()
      applyAppState(nextState, syncSettings || settingsForm === null)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
    } finally {
      setLoading(false)
    }
  })

  useEffect(() => {
    const bootId = window.setTimeout(() => {
      void refreshState(true)
    }, 0)

    const intervalId = window.setInterval(() => {
      void refreshState(false)
    }, 30_000)

    return () => {
      window.clearTimeout(bootId)
      window.clearInterval(intervalId)
    }
  }, [])

  function updateClientSchedule(targetContacts: number) {
    setClientForm((current) => {
      const nextSchedule = Array.from({ length: targetContacts }, (_, index) =>
        current.contactScheduleTimes[index] || DEFAULT_SCHEDULE_TIMES[index],
      )

      return {
        ...current,
        targetContacts,
        contactScheduleTimes: nextSchedule,
      }
    })
  }

  async function handleClientSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmittingClient(true)

    try {
      const response = await webApp.createClient(clientForm)
      applyOperationResponse(response, false)
      setClientForm(createInitialClientForm())
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
    } finally {
      setIsSubmittingClient(false)
    }
  }

  async function saveSettingsChanges() {
    if (!settingsForm) {
      return
    }

    setIsSavingSettings(true)

    const payload: SettingsInput = {
      sender: {
        fromEmail: settingsForm.fromEmail.trim(),
        fromName: settingsForm.fromName.trim(),
      },
      templates: settingsForm.templates.map((template) => ({
        ...template,
        subject: template.subject.trim(),
        body: template.body,
      })),
      automation: {
        intervalDays: Math.max(1, Number(settingsForm.intervalDays) || 2),
        autoOpenDraftOnCreate: settingsForm.autoOpenDraftOnCreate,
      },
    }

    try {
      const response = await webApp.saveSettings(payload)
      applyOperationResponse(response, true)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
    } finally {
      setIsSavingSettings(false)
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await saveSettingsChanges()
  }

  async function handleProcessQueue() {
    setIsProcessingQueue(true)

    try {
      const response = await webApp.processDueFollowUps()
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
    } finally {
      setIsProcessingQueue(false)
    }
  }

  async function handleSendClient(clientId: string) {
    setBusyClientId(clientId)

    try {
      const response = await webApp.sendClientFollowUp(clientId)
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
    } finally {
      setBusyClientId(null)
    }
  }

  async function handleToggleClient(client: ClientRecord) {
    const nextStatus = client.status === 'active' ? 'canceled' : 'active'
    setBusyClientId(client.id)

    try {
      const response = await webApp.updateClientStatus(client.id, nextStatus)
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
    } finally {
      setBusyClientId(null)
    }
  }

  async function handleDeleteClient(client: ClientRecord) {
    const shouldDelete = window.confirm(
      `Vas a eliminar a ${client.name}. Esta accion no se puede deshacer.`,
    )

    if (!shouldDelete) {
      return
    }

    setBusyClientId(client.id)

    try {
      const response = await webApp.deleteClient(client.id)
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
    } finally {
      setBusyClientId(null)
    }
  }

  if (loading || !appState || !settingsForm) {
    return (
      <main className="crm-shell">
        <section className="loading-stage panel">
          <img alt="Hessa Enterprises" className="loading-wordmark" src={logoWordmark} />
          <div className="loading-copy">
            <span className="eyebrow">Hessa Follow Up Web</span>
            <h1>Cargando la cabina web...</h1>
            <p>Estamos preparando clientes, horarios y plantillas.</p>
          </div>
        </section>
      </main>
    )
  }

  const activeClients = appState.clients.filter((client) => client.status === 'active')
  const finishedClients = appState.clients.filter((client) => client.status === 'finished')
  const canceledClients = appState.clients.filter((client) => client.status === 'canceled')
  const statCards = [
    { label: 'Total clientes', value: appState.stats.total },
    { label: 'En seguimiento', value: appState.stats.active },
    { label: 'Pendientes ahora', value: appState.stats.dueNow, tone: 'accent' },
    { label: 'Finalizados', value: appState.stats.finished },
    { label: 'Con error', value: appState.stats.withErrors },
  ]
  const heroFacts = [
    {
      label: 'Operacion',
      value: settingsForm.autoOpenDraftOnCreate ? 'Asistida' : 'Manual',
      text: settingsForm.autoOpenDraftOnCreate
        ? 'Si el primer contacto ya esta en hora, se abre el borrador automaticamente.'
        : 'Tu decides cuando abrir cada borrador del seguimiento.',
    },
    {
      label: 'Cadencia',
      value: `${settingsForm.intervalDays} dias`,
      text: 'Entre cada contacto se respeta el intervalo configurado.',
    },
    {
      label: 'Entorno',
      value: appState.runtimeInfo.browser,
      text: 'Los datos se guardan solo en este navegador.',
    },
  ]

  return (
    <main className="crm-shell">
      <section className="hero-grid">
        <article className="panel brand-stage">
          <div className="brand-stage-header">
            <span className="eyebrow">Hessa Enterprises</span>
            <span className="stage-chip">Follow-up web workspace</span>
          </div>

          <div className="brand-stage-visual">
            <div className="brand-glow"></div>
            <img alt="Hessa Enterprises" className="brand-wordmark" src={logoWordmark} />
          </div>

          <div className="brand-stage-footer">
            <span className="brand-caption">Sales follow-up operating system</span>
            <p>
              Una version web para organizar seguimientos comerciales, abrir borradores
              y mantener visible el estado de cada cliente.
            </p>
          </div>
        </article>

        <article className="panel hero-brief">
          <span className="eyebrow">Hessa Follow Up Web</span>
          <h1>Una cabina web mas clara para mover cada seguimiento comercial.</h1>
          <p className="lede">
            Define cuantas veces contactar a cada cliente, programa la hora exacta de
            cada intento y abre los correos como borradores desde una sola vista.
          </p>

          <div className="hero-action-bar">
            <button
              className="primary-button"
              disabled={isProcessingQueue}
              onClick={() => void handleProcessQueue()}
              type="button"
            >
              {isProcessingQueue
                ? 'Abriendo siguiente borrador...'
                : 'Abrir siguiente borrador pendiente'}
            </button>

            <div className="hero-runtime">
              <strong>{appState.runtimeInfo.browser}</strong>
              <span>Web app · datos locales en este navegador</span>
            </div>
          </div>

          <div className="hero-fact-grid">
            {heroFacts.map((fact) => (
              <div className="hero-fact-card" key={fact.label}>
                <span>{fact.label}</span>
                <strong>{fact.value}</strong>
                <p>{fact.text}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div className="notice notice-info">
        Esta version web guarda la informacion en <code>localStorage</code> y abre los
        correos como borradores en tu cliente de correo predeterminado. Si mas adelante
        quieres envio automatico real, el siguiente paso seria agregar un backend o un
        servicio de correo.
      </div>

      {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}

      <section className="metric-ribbon">
        {statCards.map((card) => (
          <article
            className={`panel metric-card ${card.tone === 'accent' ? 'metric-card-accent' : ''}`}
            key={card.label}
          >
            <span className="metric-label">{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace-grid">
        <div className="control-column">
          <article className="panel studio-card">
            <div className="studio-heading">
              <span className="section-index">01</span>
              <div>
                <span className="eyebrow">Client intake</span>
                <h2>Crear un flujo nuevo</h2>
              </div>
            </div>

            <form className="stack-form" onSubmit={handleClientSubmit}>
              <label className="field">
                <span>Nombre del cliente</span>
                <input
                  onChange={(event) =>
                    setClientForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Ej. Laura Ramirez"
                  required
                  type="text"
                  value={clientForm.name}
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Correo</span>
                  <input
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="cliente@empresa.com"
                    required
                    type="email"
                    value={clientForm.email}
                  />
                </label>

                <label className="field">
                  <span>Empresa</span>
                  <input
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, company: event.target.value }))
                    }
                    placeholder="Opcional"
                    type="text"
                    value={clientForm.company}
                  />
                </label>
              </div>

              <label className="field">
                <span>Notas internas</span>
                <textarea
                  onChange={(event) =>
                    setClientForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="Contexto comercial, observaciones, prioridad..."
                  rows={4}
                  value={clientForm.notes}
                />
              </label>

              <div className="composer-topline">
                <label className="field compact-field">
                  <span>Contactos maximos</span>
                  <select
                    className="select-input"
                    onChange={(event) => updateClientSchedule(Number(event.target.value))}
                    value={clientForm.targetContacts}
                  >
                    {Array.from({ length: MAX_CONTACTS }, (_, index) => {
                      const option = index + 1
                      return (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      )
                    })}
                  </select>
                </label>

                <div className="composer-note">
                  <strong>{settingsForm.intervalDays} dias entre cada intento</strong>
                  <span>Las horas siguientes se usan por intento individual.</span>
                </div>
              </div>

              <div className="schedule-board">
                {clientForm.contactScheduleTimes.map((time, index) => (
                  <label className="schedule-tile" key={`contact-time-${index + 1}`}>
                    <span>Intento {index + 1}</span>
                    <input
                      onChange={(event) =>
                        setClientForm((current) => ({
                          ...current,
                          contactScheduleTimes: current.contactScheduleTimes.map((item, itemIndex) =>
                            itemIndex === index ? event.target.value : item,
                          ),
                        }))
                      }
                      required
                      type="time"
                      value={time}
                    />
                  </label>
                ))}
              </div>

              <button className="primary-button full-width" disabled={isSubmittingClient} type="submit">
                {isSubmittingClient ? 'Guardando cliente...' : 'Guardar cliente'}
              </button>
            </form>
          </article>

          <article className="panel studio-card">
            <div className="studio-heading">
              <span className="section-index">02</span>
              <div>
                <span className="eyebrow">Web setup</span>
                <h2>Identidad y reglas del flujo</h2>
              </div>
            </div>

            <form className="stack-form" onSubmit={handleSaveSettings}>
              <div className="field-row">
                <label className="field">
                  <span>Correo de referencia</span>
                  <input
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current ? { ...current, fromEmail: event.target.value } : current,
                      )
                    }
                    placeholder="ventas@empresa.com"
                    type="email"
                    value={settingsForm.fromEmail}
                  />
                </label>

                <label className="field">
                  <span>Nombre visible</span>
                  <input
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current ? { ...current, fromName: event.target.value } : current,
                      )
                    }
                    placeholder="Hessa Enterprises"
                    type="text"
                    value={settingsForm.fromName}
                  />
                </label>
              </div>

              <div className="field-row">
                <label className="field compact-field">
                  <span>Intervalo entre contactos</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current ? { ...current, intervalDays: event.target.value } : current,
                      )
                    }
                    required
                    type="text"
                    value={settingsForm.intervalDays}
                  />
                </label>

                <div className="composer-note">
                  <strong>Salida asistida por tu navegador</strong>
                  <span>La cuenta real que enviara el correo depende de tu app de mail.</span>
                </div>
              </div>

              <label className="checkbox-field">
                <input
                  checked={settingsForm.autoOpenDraftOnCreate}
                  onChange={(event) =>
                    setSettingsForm((current) =>
                      current
                        ? { ...current, autoOpenDraftOnCreate: event.target.checked }
                        : current,
                    )
                  }
                  type="checkbox"
                />
                <span>Abrir el primer borrador automaticamente si ya esta en hora</span>
              </label>

              <button className="secondary-button full-width" disabled={isSavingSettings} type="submit">
                {isSavingSettings ? 'Guardando configuracion...' : 'Guardar configuracion web'}
              </button>
            </form>
          </article>

          <article className="panel studio-card">
            <div className="studio-heading">
              <span className="section-index">03</span>
              <div>
                <span className="eyebrow">Template studio</span>
                <h2>Editar mensajes por intento</h2>
              </div>
            </div>

            <div className="template-stack">
              {settingsForm.templates.map((template, index) => (
                <div className="template-editor" key={template.id}>
                  <div className="template-editor-head">
                    <strong>{template.title}</strong>
                    <span>Correo {index + 1}</span>
                  </div>

                  <label className="field">
                    <span>Asunto</span>
                    <input
                      onChange={(event) =>
                        setSettingsForm((current) =>
                          current
                            ? {
                                ...current,
                                templates: current.templates.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, subject: event.target.value }
                                    : item,
                                ),
                              }
                            : current,
                        )
                      }
                      type="text"
                      value={template.subject}
                    />
                  </label>

                  <label className="field">
                    <span>Cuerpo</span>
                    <textarea
                      onChange={(event) =>
                        setSettingsForm((current) =>
                          current
                            ? {
                                ...current,
                                templates: current.templates.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, body: event.target.value } : item,
                                ),
                              }
                            : current,
                        )
                      }
                      rows={7}
                      value={template.body}
                    />
                  </label>
                </div>
              ))}
            </div>

            <div className="token-rack">
              {templateTokens.map((token) => (
                <code key={token}>{token}</code>
              ))}
            </div>

            <button
              className="secondary-button full-width"
              disabled={isSavingSettings}
              onClick={() => void saveSettingsChanges()}
              type="button"
            >
              {isSavingSettings ? 'Guardando templates...' : 'Guardar templates y reglas'}
            </button>
          </article>
        </div>

        <div className="board-column">
          <article className="panel board-stage">
            <div className="board-stage-copy">
              <span className="eyebrow">Inbox operativo</span>
              <h2>Todo el avance comercial en una vista central</h2>
              <p>
                Revisa clientes activos, identifica el proximo borrador, detecta bloqueos
                y mueve a eliminacion los que ya completaron su secuencia.
              </p>
            </div>

            <div className="board-stage-pillbox">
              <div className="board-chip">
                <span>Activos</span>
                <strong>{activeClients.length}</strong>
              </div>
              <div className="board-chip">
                <span>Finalizados</span>
                <strong>{finishedClients.length}</strong>
              </div>
            </div>
          </article>

          <section className="board-section">
            <div className="section-banner">
              <div>
                <span className="eyebrow">Live queue</span>
                <h3>Clientes en seguimiento</h3>
              </div>
              <span className="section-count">{activeClients.length}</span>
            </div>

            {activeClients.length === 0 ? (
              <article className="panel empty-state">
                <h3>No hay clientes activos</h3>
                <p>Cuando agregues clientes nuevos apareceran aqui con toda su secuencia.</p>
              </article>
            ) : (
              <div className="board-list">
                {activeClients.map((client) => {
                  const attemptStatuses = createAttemptStatuses(client)
                  const isBusy = busyClientId === client.id
                  const isLastAttempt = client.sentContacts === client.targetContacts - 1

                  return (
                    <article className="panel inbox-card" key={client.id}>
                      <div className="inbox-card-top">
                        <div>
                          <div className="identity-row">
                            <span className="status-pill pill-active">
                              {getClientStatusLabel(client.status)}
                            </span>
                            <span className="meta-pill">{getClientStageLabel(client)}</span>
                          </div>
                          <h3>{client.name}</h3>
                          <p className="client-subtitle">
                            {client.company || 'Sin empresa'} · {client.email}
                          </p>
                        </div>

                        <div className="next-window">
                          <span>Proximo borrador</span>
                          <strong>{formatRelativeDue(client.nextContactAt)}</strong>
                          <small>{formatDateTime(client.nextContactAt)}</small>
                        </div>
                      </div>

                      {isLastAttempt ? (
                        <div className="final-attempt-banner">
                          Este cliente esta entrando en su ultimo intento programado.
                        </div>
                      ) : null}

                      <div className="attempt-track">
                        {attemptStatuses.map((status, index) => (
                          <div className={`attempt-node attempt-node-${status}`} key={`${client.id}-${index + 1}`}>
                            <span>{index + 1}</span>
                            <strong>{client.contactScheduleTimes[index]}</strong>
                          </div>
                        ))}
                      </div>

                      <div className="meta-grid">
                        <div className="meta-card">
                          <span className="meta-label">Contactos avanzados</span>
                          <strong>{client.sentContacts}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Ultimo borrador</span>
                          <strong>{formatDateTime(client.lastContactAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Creado</span>
                          <strong>{formatDateTime(client.createdAt)}</strong>
                        </div>
                      </div>

                      {client.lastError ? <div className="error-box">{client.lastError}</div> : null}
                      {client.notes ? <p className="client-note">{client.notes}</p> : null}

                      <div className="action-row">
                        <button
                          className="primary-button"
                          disabled={isBusy}
                          onClick={() => void handleSendClient(client.id)}
                          type="button"
                        >
                          {isBusy ? 'Abriendo...' : 'Abrir borrador'}
                        </button>

                        <button
                          className="ghost-button"
                          disabled={isBusy}
                          onClick={() => void handleToggleClient(client)}
                          type="button"
                        >
                          Detener cliente
                        </button>
                      </div>

                      <div className="history-stack">
                        <div className="history-header">
                          <span className="eyebrow">Activity</span>
                        </div>

                        {client.history.length === 0 ? (
                          <p className="history-empty">
                            Aun no se ha abierto ningun borrador para este cliente.
                          </p>
                        ) : (
                          client.history.slice(0, 4).map((item) => (
                            <div className="history-row" key={item.id}>
                              <div className="history-main">
                                <strong>
                                  Intento {item.contactNumber} ·{' '}
                                  {item.status === 'prepared' ? 'Borrador abierto' : 'Con error'}
                                </strong>
                                <span>{item.subject}</span>
                              </div>
                              <div className="history-side">
                                <span>{formatDateTime(item.happenedAt)}</span>
                                <small>{item.error || item.preview}</small>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="board-section">
            <div className="section-banner">
              <div>
                <span className="eyebrow">Completed</span>
                <h3>Flujos finalizados</h3>
              </div>
              <span className="section-count">{finishedClients.length}</span>
            </div>

            {finishedClients.length === 0 ? (
              <article className="panel empty-state">
                <h3>Sin clientes finalizados</h3>
                <p>Los clientes que completen todos sus intentos apareceran aqui.</p>
              </article>
            ) : (
              <div className="board-list">
                {finishedClients.map((client) => {
                  const isBusy = busyClientId === client.id

                  return (
                    <article className="panel archive-card" key={client.id}>
                      <div className="archive-top">
                        <div>
                          <span className="eyebrow">Ready to archive</span>
                          <h3>{client.name}</h3>
                          <p className="client-subtitle">
                            Flujo completado con {client.sentContacts} de {client.targetContacts}{' '}
                            intentos.
                          </p>
                        </div>

                        <img alt="Hessa Enterprises" className="archive-wordmark" src={logoWordmark} />
                      </div>

                      <div className="archive-highlight">
                        <strong>Ya se finalizo con este cliente</strong>
                        <span>
                          Puedes conservarlo como referencia o eliminarlo ahora mismo.
                        </span>
                      </div>

                      <div className="meta-grid">
                        <div className="meta-card">
                          <span className="meta-label">Finalizado</span>
                          <strong>{formatDateTime(client.finishedAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Ultimo borrador</span>
                          <strong>{formatDateTime(client.lastContactAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Empresa</span>
                          <strong>{client.company || 'Sin empresa'}</strong>
                        </div>
                      </div>

                      <button
                        className="danger-button"
                        disabled={isBusy}
                        onClick={() => void handleDeleteClient(client)}
                        type="button"
                      >
                        {isBusy ? 'Eliminando...' : 'Eliminar cliente'}
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {canceledClients.length > 0 ? (
            <section className="board-section">
              <div className="section-banner">
                <div>
                  <span className="eyebrow">Paused</span>
                  <h3>Clientes detenidos manualmente</h3>
                </div>
                <span className="section-count">{canceledClients.length}</span>
              </div>

              <div className="board-list">
                {canceledClients.map((client) => {
                  const isBusy = busyClientId === client.id

                  return (
                    <article className="panel paused-card" key={client.id}>
                      <div className="inbox-card-top">
                        <div>
                          <div className="identity-row">
                            <span className="status-pill pill-canceled">
                              {getClientStatusLabel(client.status)}
                            </span>
                            <span className="meta-pill">{getClientStageLabel(client)}</span>
                          </div>
                          <h3>{client.name}</h3>
                          <p className="client-subtitle">
                            {client.company || 'Sin empresa'} · {client.email}
                          </p>
                        </div>

                        <div className="next-window muted-window">
                          <span>Detenido</span>
                          <strong>{formatDateTime(client.canceledAt)}</strong>
                          <small>Listo para reactivar</small>
                        </div>
                      </div>

                      <button
                        className="secondary-button"
                        disabled={isBusy}
                        onClick={() => void handleToggleClient(client)}
                        type="button"
                      >
                        {isBusy ? 'Reprogramando...' : 'Reactivar cliente'}
                      </button>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default App
