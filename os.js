// =============================================================================
// OS.JS - AIOTI Kanban v3
// =============================================================================

const COLUMNS = [
  { status: "pendente", color: "#f59e0b" },
  { status: "em_processo", color: "#3b82f6" },
  { status: "em_verificacao", color: "#a855f7" },
  { status: "concluida", color: "#2aff7b" }
]

const COLUMN_STATUSES = new Set(COLUMNS.map((item) => item.status))
const STATUS_LABELS = {
  pendente: "Tarefa pendente",
  em_processo: "Em processo",
  em_verificacao: "Em verifica\u00e7\u00e3o",
  concluida: "Conclu\u00edda",
  cancelada: "Cancelada"
}

const STATUS_CREATE_TOAST = {
  pendente: "Uma nova Tarefa Pendente foi gerada",
  em_processo: "Uma nova OS em Processo foi gerada",
  em_verificacao: "Uma nova OS em Verifica\u00e7\u00e3o foi gerada",
  concluida: "Uma nova OS Conclu\u00edda foi gerada"
}

const TASK_STATUS_LABELS = {
  nao_iniciada: "N\u00e3o iniciada",
  em_andamento: "Em andamento",
  em_verificacao: "Em verifica\u00e7\u00e3o",
  concluida: "Conclu\u00edda",
  cancelada: "Cancelada"
}

const WEEK_DAY_COLUMNS = [
  { label: "Segunda-feira", aliases: ["segunda-feira", "segunda feira", "segunda", "seg", "mon", "monday"] },
  { label: "Ter\u00e7a-feira", aliases: ["terca-feira", "terca feira", "terca", "ter", "tue", "tuesday"] },
  { label: "Quarta-feira", aliases: ["quarta-feira", "quarta feira", "quarta", "qua", "wed", "wednesday"] },
  { label: "Quinta-feira", aliases: ["quinta-feira", "quinta feira", "quinta", "qui", "thu", "thursday"] },
  { label: "Sexta-feira", aliases: ["sexta-feira", "sexta feira", "sexta", "sex", "fri", "friday"] },
  { label: "S\u00e1bado", aliases: ["sabado", "sabado-feira", "sab", "sat", "saturday"] }
]

const KB = {
  currentOs: null,
  currentOsDetail: null,
  currentTask: null,
  currentTaskTab: "task",
  currentTaskFilter: "all",
  currentStep: 1,
  assetFilters: {},
  assetSearch: "",
  selectedAsset: null,
  subtasks: [],
  resources: [],
  failedChecked: false,
  serviceChecked: false,
  alreadyDoneChecked: false,
  selectedResponsavel: null,
  respUsers: [],
  _searchTimer: null,
  _assetTimer: null,
  _respTimer: null,
  _autoRefresh: null,
  _statusTarget: null,
  workOrdersByStatus: {},
  workOrderCache: new Map(),
  detailRequestSeq: 0,
  drag: {
    id: null,
    fromStatus: null,
    workOrder: null,
    ignoreClickUntil: 0
  },
  taskRegisterOpen: false,
  taskRegisterDraft: { duration: "", note: "" },
  pendingAttachment: null,
  attachmentsLoading: false
}

document.addEventListener("DOMContentLoaded", () => {
  initUser()
  bindTopbar()
  bindBoardDragAndDrop()
  bindFab()
  bindWizard()
  bindAssetDrawer()
  bindRespDrawer()
  bindDetailDrawer()
  bindTaskModalShell()
  bindStatusPopover()
  loadAllColumns()
  loadWizardOptions()
  KB._autoRefresh = setInterval(() => loadAllColumns({ silent: true }), 45000)
})

// =============================================================================
// Wizard options (dynamic from API)
// =============================================================================

async function loadWizardOptions() {
  function populate(selectId, names) {
    const el = document.getElementById(selectId)
    if (!el) return
    names.forEach((name) => {
      const opt = document.createElement("option")
      opt.value = name
      opt.textContent = name
      el.appendChild(opt)
    })
  }

  try {
    const [opts, classifications] = await Promise.all([
      apiJson("/os-options"),
      apiJson("/os-classifications"),
    ])

    populate("f-task-type", (opts.task_type || []).map((i) => i.name))
    populate("f-criticality", (opts.criticality || []).map((i) => i.name))

    const level1 = (classifications.items || []).filter((i) => i.level === 1 || !i.level)
    populate("f-class1", level1.map((i) => i.name))

    const level2Names = level1.flatMap((i) => (i.children || []).map((c) => c.name))
    populate("f-class2", level2Names)
  } catch (_err) {
    // silently fail — selects keep "Selecionar..." only
  }
}

// =============================================================================
// User / theme
// =============================================================================

function initUser() {
  const user = JSON.parse(localStorage.getItem("user") || "{}")
  const name = user.name || user.username || "?"
  const initials = avatarInitials(name)
  const userAvatar = document.getElementById("userAvatar")
  const userNameDisplay = document.getElementById("userNameDisplay")
  const requestedBy = document.getElementById("f-requested-by")

  if (userAvatar) userAvatar.textContent = initials
  if (userNameDisplay) userNameDisplay.textContent = name
  if (requestedBy) requestedBy.value = name

  document.getElementById("logoutBtn")?.addEventListener("click", () => {
    if (typeof logout === "function") logout()
    else {
      localStorage.clear()
      window.location = "index.html"
    }
  })
}

// =============================================================================
// API helpers
// =============================================================================

async function readJsonResponse(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_error) {
    return { raw: text }
  }
}

async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options)
  const data = await readJsonResponse(res)

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && (data.error || data.message || data.detail)) ||
      `HTTP ${res.status}`
    const err = new Error(message)
    err.status = res.status
    err.data = data
    throw err
  }

  return data
}

function apiUserHeaders(extra = {}) {
  const user = JSON.parse(localStorage.getItem("user") || "{}")
  const headers = { ...extra }
  if (user.customer_id) headers["X-Customer-Id"] = user.customer_id
  if (user.is_superuser === true) headers["X-Is-Superuser"] = "true"
  return headers
}

function getApiBase() {
  return typeof API_BASE === "string" ? API_BASE : ""
}

// =============================================================================
// Topbar / board
// =============================================================================

function bindTopbar() {
  document.getElementById("kbSearchInput")?.addEventListener("input", () => {
    clearTimeout(KB._searchTimer)
    KB._searchTimer = setTimeout(() => loadAllColumns(), 350)
  })

  document.getElementById("kbRefreshBtn")?.addEventListener("click", () => loadAllColumns())

  document.querySelectorAll(".kb-col-refresh").forEach((btn) => {
    btn.addEventListener("click", () => loadColumn(btn.dataset.col))
  })
}

function bindBoardDragAndDrop() {
  document.querySelectorAll(".kb-col-body").forEach((body) => {
    body.addEventListener("dragover", handleColumnDragOver)
    body.addEventListener("dragenter", handleColumnDragOver)
    body.addEventListener("drop", handleColumnDrop)
  })
}

async function loadAllColumns({ silent = false } = {}) {
  const q = getBoardSearch()
  await Promise.all(COLUMNS.map((col) => loadColumn(col.status, { silent, q })))
}

async function refreshColumns(statuses, { silent = true } = {}) {
  const q = getBoardSearch()
  const targets = [...new Set((statuses || []).filter((status) => COLUMN_STATUSES.has(status)))]
  if (!targets.length) return
  await Promise.all(targets.map((status) => loadColumn(status, { silent, q })))
}

async function loadColumn(status, { silent = false, q = "" } = {}) {
  const col = document.getElementById(`col-${status}`)
  const loading = document.getElementById(`loading-${status}`)
  const countEl = document.getElementById(`count-${status}`)
  if (!col) return

  if (!silent) {
    loading?.classList.remove("hidden")
    col.innerHTML = ""
    if (loading) col.appendChild(loading)
  }

  const params = new URLSearchParams({ status })
  if (q) params.set("q", q)

  try {
    const data = await apiJson(`/work-orders?${params.toString()}`)
    const items = normalizeWorkOrderList(data)
    KB.workOrdersByStatus[status] = items
    items.forEach(cacheWorkOrder)
    if (countEl) countEl.textContent = String(items.length)
    renderColumn(status, items)
  } catch (error) {
    console.error("[KB] load column", status, error)
    if (!silent) {
      col.innerHTML =
        '<div class="kb-empty"><i class="fa-solid fa-triangle-exclamation"></i><span>Erro ao carregar</span></div>'
    }
  } finally {
    loading?.classList.add("hidden")
  }
}

function renderColumn(status, items) {
  const col = document.getElementById(`col-${status}`)
  if (!col) return

  col.innerHTML = ""
  if (!items.length) {
    col.innerHTML =
      '<div class="kb-empty"><i class="fa-regular fa-rectangle-list"></i><span>Nenhuma OS aqui</span></div>'
    return
  }

  items.forEach((os) => col.appendChild(buildCard(os)))
}

function buildCard(workOrder) {
  const card = document.createElement("div")
  const progress = getProgressValue(workOrder)
  const status = workOrder.status || "pendente"
  const assignee = workOrder.responsavel_name || workOrder.assignee_name || workOrder.requested_by || "Sem responsavel"
  const scheduledDate = workOrder.scheduled_date || null
  const assetCode = workOrder.asset_code || workOrder.asset_location || ""
  const detailEnabled = canOpenDetailFromCard(workOrder)

  card.className = "kb-card"
  card.style.setProperty("--card-accent", getStatusColor(status))
  card.dataset.id = String(getWorkOrderId(workOrder) || "")
  card.dataset.status = status
  card.dataset.detailEnabled = String(detailEnabled)
  card.setAttribute("draggable", "true")

  const badges = []
  if (!scheduledDate) badges.push('<span class="kb-card-badge kb-card-badge--neutral">N\u00c3O PLANEJADO</span>')
  if (status === "cancelada") badges.push('<span class="kb-card-badge kb-card-badge--cancelled">CANCELADO</span>')

  card.innerHTML = `
    <div class="kb-card-top">
      <div class="kb-card-top-copy">
        <button type="button" class="kb-card-link" data-open-detail>${esc(workOrder.os_number || workOrder.id || "-")}</button>
        <div class="kb-card-creator">Criado por ${esc(workOrder.created_by || workOrder.requested_by || "---")}</div>
      </div>
      <div class="kb-card-badges">${badges.join("")}</div>
    </div>
    <div class="kb-card-asset"><span class="kb-card-label">Ativo:</span><strong>${esc(workOrder.asset_name || "Ativo nao informado")}${assetCode ? ` { ${esc(assetCode)} }` : ""}</strong></div>
    <div class="kb-card-task"><span class="kb-card-label">Tarefa:</span>${esc(workOrder.task_description || "Sem descricao")}</div>
    <div class="kb-card-progress-row">
      <div class="kb-progress-bar"><div class="kb-progress-fill" style="width:${progress}%"></div></div>
      <div class="kb-progress-pct">${progress}%</div>
    </div>
    <div class="kb-card-meta-row">
      <div class="kb-card-meta">
        <div class="kb-meta-item"><i class="fa-regular fa-clock"></i>${esc(formatDurationCompact(workOrder.estimated_duration))}</div>
        <div class="kb-meta-item ${isOverdue(workOrder) ? "overdue" : ""}"><i class="fa-regular fa-calendar"></i>${esc(scheduledDate ? fmtDate(scheduledDate) : "Sem data")}</div>
      </div>
    </div>
    <div class="kb-card-bottom">
      <div class="kb-assignee-av" title="${esc(assignee)}">${avatarInitials(assignee)}</div>
      <div class="kb-card-actions">
        <button type="button" class="kb-card-action-btn" data-action="share" title="Compartilhar"><i class="fa-solid fa-share-nodes"></i></button>
        <button type="button" class="kb-card-action-btn" data-action="menu" title="Mudar status"><i class="fa-solid fa-ellipsis-vertical"></i></button>
      </div>
    </div>
  `

  card.addEventListener("click", (event) => {
    if (Date.now() < KB.drag.ignoreClickUntil) return
    if (event.target.closest("[data-action]")) return
    if (!detailEnabled) return
    openDetail(workOrder)
  })

  card.querySelector("[data-open-detail]")?.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    openDetail(workOrder)
  })

  card.querySelector('[data-action="share"]')?.addEventListener("click", async (event) => {
    event.stopPropagation()
    await shareWorkOrder(workOrder)
  })

  card.querySelector('[data-action="menu"]')?.addEventListener("click", (event) => {
    event.stopPropagation()
    openStatusPopover(event.currentTarget, workOrder)
  })

  card.addEventListener("dragstart", (event) => handleCardDragStart(event, workOrder, card))
  card.addEventListener("dragend", () => handleCardDragEnd(card))

  return card
}

async function shareWorkOrder(workOrder) {
  const title = `OS #${workOrder.os_number || workOrder.id || "-"}`
  const text = `${title} - ${workOrder.task_description || workOrder.asset_name || "Sem descricao"}`

  if (navigator.share) {
    try {
      await navigator.share({ title, text })
      showToast("Detalhes da OS compartilhados", "success")
      return
    } catch (_error) {}
  }

  try {
    await navigator.clipboard.writeText(text)
    showToast("Detalhes da OS copiados", "success")
  } catch (_error) {
    showToast("Nao foi possivel compartilhar a OS", "error")
  }
}

function handleCardDragStart(event, workOrder, card) {
  const id = getWorkOrderId(workOrder)
  if (!id) {
    event.preventDefault()
    return
  }

  KB.drag.id = id
  KB.drag.fromStatus = workOrder.status || null
  KB.drag.workOrder = workOrder

  card.classList.add("kb-card--dragging")
  event.dataTransfer.effectAllowed = "move"
  event.dataTransfer.setData("text/plain", String(id))
}

function handleCardDragEnd(card) {
  card.classList.remove("kb-card--dragging")
  KB.drag.ignoreClickUntil = Date.now() + 150
  clearDropTargets()
  KB.drag.id = null
  KB.drag.fromStatus = null
  KB.drag.workOrder = null
}

function handleColumnDragOver(event) {
  if (!KB.drag.id) return
  event.preventDefault()
  event.dataTransfer.dropEffect = "move"
  const status = event.currentTarget.closest(".kb-col")?.dataset.status
  highlightDropTarget(status)
}

async function handleColumnDrop(event) {
  event.preventDefault()
  const targetStatus = event.currentTarget.closest(".kb-col")?.dataset.status
  const { id, fromStatus, workOrder } = KB.drag
  clearDropTargets()

  if (!id || !targetStatus || !fromStatus || targetStatus === fromStatus) return

  await changeStatus(id, targetStatus, {
    fromStatus,
    workOrder,
    reloadStatuses: [fromStatus, targetStatus],
    successMessage: buildMoveToastMessage(workOrder, targetStatus)
  })
}

function highlightDropTarget(status) {
  document.querySelectorAll(".kb-col").forEach((col) => {
    col.classList.toggle("kb-col--drop-target", col.dataset.status === status)
  })
}

function clearDropTargets() {
  document.querySelectorAll(".kb-col").forEach((col) => col.classList.remove("kb-col--drop-target"))
}

function canOpenDetailFromCard(workOrder) {
  return !!getWorkOrderId(workOrder)
}

// =============================================================================
// Status popover
// =============================================================================

function bindStatusPopover() {
  document.getElementById("statusPopover")?.addEventListener("click", async (event) => {
    const button = event.target.closest(".sp-btn")
    if (!button || !KB._statusTarget) return

    hideStatusPopover()
    await changeStatus(getWorkOrderId(KB._statusTarget), button.dataset.status, {
      fromStatus: KB._statusTarget.status,
      workOrder: KB._statusTarget,
      reloadStatuses: [KB._statusTarget.status, button.dataset.status]
    })
  })
}

function openStatusPopover(anchor, workOrder) {
  const popover = document.getElementById("statusPopover")
  if (!popover || !workOrder) return

  const rect = anchor.getBoundingClientRect()
  popover.style.top = `${rect.bottom + 8}px`
  popover.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`
  popover.classList.remove("hidden")

  KB._statusTarget = workOrder

  const hide = (event) => {
    if (!popover.contains(event.target)) {
      hideStatusPopover()
      document.removeEventListener("click", hide, true)
    }
  }

  setTimeout(() => document.addEventListener("click", hide, true), 10)
}

function hideStatusPopover() {
  document.getElementById("statusPopover")?.classList.add("hidden")
  KB._statusTarget = null
}

async function changeStatus(id, status, { fromStatus, workOrder, reloadStatuses, successMessage } = {}) {
  if (!id || !status) return

  try {
    await apiJson(`/work-orders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    })

    if (KB.currentOsDetail && getWorkOrderId(KB.currentOsDetail) === id) {
      KB.currentOsDetail.status = status
      syncPrimaryTaskStatus(KB.currentOsDetail, status)
      renderOsDetail(KB.currentOsDetail)
    }

    showToast(successMessage || `Status atualizado para ${STATUS_LABELS[status] || status}`, "success")
    await refreshColumns(reloadStatuses || [fromStatus, status])

    if (KB.currentOsDetail && getWorkOrderId(KB.currentOsDetail) === id) {
      await refreshCurrentWorkOrderDetail({ preserveTaskId: KB.currentTask?.id })
    }
  } catch (error) {
    console.error("[KB] change status", error)
    showToast("Erro ao atualizar status", "error")
  }
}

function buildMoveToastMessage(workOrder, status) {
  const number = workOrder?.os_number || workOrder?.id || "-"
  return `OS #${number} movida para ${STATUS_LABELS[status] || status}`
}

// =============================================================================
// Detail drawer
// =============================================================================

function bindDetailDrawer() {
  document.getElementById("osdCloseBtn")?.addEventListener("click", closeDetail)
  document.getElementById("osdBackBtn")?.addEventListener("click", closeDetail)
  document.getElementById("osDetailOverlay")?.addEventListener("click", closeDetail)
  document.getElementById("osdStatusBtn")?.addEventListener("click", (event) => {
    if (KB.currentOsDetail) openStatusPopover(event.currentTarget, KB.currentOsDetail)
  })
  document.getElementById("osdSaveBtn")?.addEventListener("click", saveCurrentWorkOrderDetail)
}

async function openDetail(workOrder) {
  if (!workOrder) return

  const normalizedWorkOrder = normalizeWorkOrderDetail(workOrder)
  const workOrderId = getWorkOrderId(normalizedWorkOrder)
  const requestSeq = ++KB.detailRequestSeq

  KB.currentOs = normalizedWorkOrder
  KB.currentOsDetail = normalizedWorkOrder
  cacheWorkOrder(normalizedWorkOrder)

  document.getElementById("osDetailOverlay")?.classList.remove("hidden")
  document.getElementById("osDetailDrawer")?.classList.remove("hidden")

  if (workOrderId) renderOsDetail(KB.currentOsDetail)
  else renderOsDetailLoading(KB.currentOsDetail)

  try {
    const detail = await fetchWorkOrderDetail(workOrderId, normalizedWorkOrder)
    if (requestSeq !== KB.detailRequestSeq) return

    const normalizedDetail = normalizeWorkOrderDetail(detail || normalizedWorkOrder)
    if (getWorkOrderId(normalizedDetail) !== getWorkOrderId(KB.currentOsDetail)) return

    KB.currentOsDetail = normalizedDetail
    cacheWorkOrder(KB.currentOsDetail)
    renderOsDetail(KB.currentOsDetail)
  } catch (error) {
    if (requestSeq !== KB.detailRequestSeq) return
    console.warn("[OS] detail fallback", error)
    renderOsDetail(KB.currentOsDetail)
  }
}

function closeDetail() {
  closeTaskModal()
  KB.detailRequestSeq += 1
  document.getElementById("osDetailOverlay")?.classList.add("hidden")
  document.getElementById("osDetailDrawer")?.classList.add("hidden")
  document.getElementById("osdBody").innerHTML = ""
  KB.currentOs = null
  KB.currentOsDetail = null
}

function renderOsDetailLoading(workOrder) {
  const number = workOrder?.os_number || workOrder?.id || "-"
  const osdNum = document.getElementById("osdNum")
  if (osdNum) {
    osdNum.innerHTML = `<span class="osd-num-kicker">Ordem de Servi\u00e7o</span><span class="osd-num-value">#${esc(number)}</span>`
  }
  document.getElementById("osdBody").innerHTML =
    '<div class="osd-panel"><div class="kb-loading"><span class="kb-spinner"></span></div></div>'
}

function renderOsDetail(detail) {
  if (!detail) return

  const osdNum = document.getElementById("osdNum")
  const body = document.getElementById("osdBody")
  if (!body || !osdNum) return

  const tasks = getFilteredTasks(detail)
  const taskTotal = (detail.tasks || []).length
  const progress = getProgressValue(detail)
  const responsible = detail.responsavel_name || detail.assignee_name || detail.requested_by || "Sem responsavel"
  const responsibleMeta = detail.responsavel_email || detail.created_by || detail.requested_by || "Sem informa\u00e7\u00e3o adicional"
  const scheduledDate = detail.scheduled_date || detail.incident_date || null

  osdNum.innerHTML = `<span class="osd-num-kicker">Ordem de Servi\u00e7o</span><span class="osd-num-value">#${esc(detail.os_number || detail.id || "-")}</span>`

  body.innerHTML = `
    <section class="osd-panel">
      <div class="osd-person-row">
        <div class="osd-person">
          <div class="osd-avatar">${avatarInitials(responsible)}</div>
          <div class="osd-person-copy">
            <div class="osd-person-name">${esc(responsible)} <span class="osd-person-caret"><i class="fa-solid fa-chevron-down"></i></span></div>
            <div class="osd-person-sub">${esc(responsibleMeta)}</div>
          </div>
        </div>
        <div class="osd-person-right">#${esc(detail.os_number || detail.id || "-")}</div>
      </div>
      <div class="osd-meta-strip">
        <div class="osd-meta-item ${isOverdue(detail) ? "overdue" : ""}"><i class="fa-regular fa-calendar"></i>${esc(scheduledDate ? fmtDateLong(scheduledDate) : "Sem data programada")}</div>
        <div class="osd-meta-item"><i class="fa-regular fa-clock"></i>${esc(formatDurationCompact(detail.estimated_duration))}</div>
        <span class="osd-status-pill ${esc(detail.status || "pendente")}">${esc(STATUS_LABELS[detail.status] || detail.status || "Pendente")}</span>
      </div>
      <div class="osd-progress-head">
        <div>
          <div class="osd-progress-label">Progresso</div>
          <div class="osd-progress-numbers">
            <span class="osd-progress-value">${progress}%</span>
            <span class="osd-progress-cost">Custo total: ${esc(formatCurrencyBRL(detail.total_cost || detail.cost_total || 0))}</span>
          </div>
        </div>
      </div>
      <div class="osd-progress-shell"><div class="osd-progress-fill" style="width:${progress}%"></div></div>
    </section>

    <section class="osd-section-card">
      <div class="osd-section-title">Datas</div>
      <div class="osd-field-grid">
        <div class="osd-field">
          <label for="osdScheduledDate">Data programada</label>
          <input id="osdScheduledDate" class="osd-input" type="datetime-local" value="${esc(toDatetimeLocalInputValue(detail.scheduled_date))}" />
        </div>
        <div class="osd-field">
          <label for="osdStartDate">Data inicial</label>
          <input id="osdStartDate" class="osd-input" type="datetime-local" value="${esc(toDatetimeLocalInputValue(detail.start_date))}" />
        </div>
        <div class="osd-field">
          <label for="osdEndDate">Data final</label>
          <input id="osdEndDate" class="osd-input" type="datetime-local" value="${esc(toDatetimeLocalInputValue(detail.end_date))}" />
        </div>
      </div>
    </section>

    <section class="osd-section-card">
      <div class="osd-section-title">Observa\u00e7\u00e3o</div>
      <textarea id="osdObservation" class="osd-textarea" placeholder="Digite observa\u00e7\u00f5es da ordem de servi\u00e7o...">${esc(detail.observations || "")}</textarea>
    </section>

    <section class="osd-section-card">
      <div class="osd-section-head">
        <div>
          <div class="osd-section-title">Tarefas</div>
          <div class="osd-section-meta">Total: ${taskTotal}</div>
        </div>
        <select id="osdTaskFilter" class="task-select osd-filter">
          <option value="all" ${KB.currentTaskFilter === "all" ? "selected" : ""}>Todas</option>
          <option value="open" ${KB.currentTaskFilter === "open" ? "selected" : ""}>N\u00e3o iniciadas</option>
          <option value="running" ${KB.currentTaskFilter === "running" ? "selected" : ""}>Em andamento</option>
          <option value="done" ${KB.currentTaskFilter === "done" ? "selected" : ""}>Conclu\u00eddas</option>
        </select>
      </div>
      <div class="osd-task-list">
        ${tasks.length ? tasks.map((task) => renderOsDetailTaskCard(task)).join("") : '<div class="task-empty">Nenhuma tarefa encontrada para este filtro.</div>'}
      </div>
    </section>
  `

  document.getElementById("osdTaskFilter")?.addEventListener("change", (event) => {
    KB.currentTaskFilter = event.target.value
    renderOsDetail(detail)
  })

  body.querySelectorAll("[data-task-id]").forEach((element) => {
    element.addEventListener("click", () => {
      const taskId = element.dataset.taskId
      const task = findTaskById(detail, taskId)
      if (task) openTaskModal(task)
    })
  })
}

function renderOsDetailTaskCard(task) {
  const taskStatus = normalizeTaskStatus(task.status)
  return `
    <button type="button" class="osd-task-card" data-task-id="${esc(task.id)}">
      <div class="osd-task-asset-row">
        <div>
          <div class="osd-task-title">${esc(task.asset_name || "Ativo")}${task.asset_code ? ` { ${esc(task.asset_code)} }` : ""}</div>
          <div class="osd-task-sub">${esc(task.asset_location ? `// ${task.asset_location}` : "// Sem local informado")}</div>
        </div>
        <span class="osd-task-arrow"><i class="fa-solid fa-chevron-right"></i></span>
      </div>
      <div class="osd-task-main-row">
        <div>
          <div class="osd-task-title">${esc(task.name || "Sem titulo")}</div>
          <div class="osd-task-meta">
            <span>Criticidade: ${esc(formatCriticality(task.criticality).label)}</span>
            <span>Tipo de tarefa: ${esc(task.task_type || "---")}</span>
            <span>Classifica\u00e7\u00e3o 1: ${esc(task.classification_1 || "---")}</span>
            <span>Classifica\u00e7\u00e3o 2: ${esc(task.classification_2 || "---")}</span>
            <span>N\u00famero de solicita\u00e7\u00e3o: ${esc(task.request_number || "---")}</span>
            <span>Data programada: ${esc(task.scheduled_date ? fmtDateLong(task.scheduled_date) : "---")}</span>
            <span>Dura\u00e7\u00e3o estimada: ${esc(formatDurationLong(task.estimated_duration))}</span>
          </div>
        </div>
      </div>
      <div class="osd-task-footer">
        <div class="osd-task-counts">Recursos ${task.resources.length} | Anexos ${task.attachments.length}</div>
        <span class="osd-task-status ${esc(taskStatus)}">${esc(TASK_STATUS_LABELS[taskStatus] || taskStatus)}</span>
      </div>
    </button>
  `
}

async function saveCurrentWorkOrderDetail() {
  if (!KB.currentOsDetail) return

  const nextDetail = cloneWorkOrderDetail(KB.currentOsDetail)
  nextDetail.observations = document.getElementById("osdObservation")?.value?.trim() || ""
  nextDetail.scheduled_date = readDatetimeLocalValue("osdScheduledDate")
  nextDetail.start_date = readDatetimeLocalValue("osdStartDate")
  nextDetail.end_date = readDatetimeLocalValue("osdEndDate")
  syncPrimaryTaskToDetail(nextDetail)

  await persistWorkOrderDetail(nextDetail, "OS atualizada com sucesso")
}

async function fetchWorkOrderDetail(id, fallback = null) {
  if (!id) return normalizeWorkOrderDetail(fallback)

  try {
    const data = await apiJson(`/work-orders/${id}`)
    return data?.item || data?.work_order || data
  } catch (error) {
    const cached = KB.workOrderCache.get(String(id))
    if (cached) return cached
    if (fallback) return fallback
    throw error
  }
}

async function refreshCurrentWorkOrderDetail({ preserveTaskId = null } = {}) {
  if (!KB.currentOsDetail) return

  const detail = await fetchWorkOrderDetail(getWorkOrderId(KB.currentOsDetail), KB.currentOsDetail)
  KB.currentOsDetail = normalizeWorkOrderDetail(detail)
  cacheWorkOrder(KB.currentOsDetail)
  renderOsDetail(KB.currentOsDetail)

  if (preserveTaskId && KB.currentTask) {
    const refreshedTask = findTaskById(KB.currentOsDetail, preserveTaskId)
    if (refreshedTask) {
      KB.currentTask = refreshedTask
      renderTaskModal()
    }
  }
}

async function persistWorkOrderDetail(nextDetail, successMessage) {
  const saveBtn = document.getElementById("osdSaveBtn")
  const taskId = KB.currentTask?.id || null
  const previousStatus = KB.currentOsDetail?.status || nextDetail.status
  const nextStatus = nextDetail.status || previousStatus

  if (saveBtn) {
    saveBtn.disabled = true
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando'
  }

  try {
    const payload = buildWorkOrderPatchPayload(nextDetail)
    const response = await apiJson(`/work-orders/${getWorkOrderId(nextDetail)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })

    const updated = normalizeWorkOrderDetail(response?.item || response?.work_order || { ...nextDetail, ...(response || {}) })
    KB.currentOs = updated
    KB.currentOsDetail = updated
    cacheWorkOrder(updated)

    renderOsDetail(updated)
    if (KB.currentTask) {
      KB.currentTask = findTaskById(updated, taskId) || updated.tasks?.[0] || null
      renderTaskModal()
    }

    showToast(successMessage || "OS atualizada", "success")
    await refreshColumns(previousStatus === nextStatus ? [nextStatus] : [previousStatus, nextStatus])
  } catch (error) {
    console.error("[OS] patch", error)
    showToast(`Erro ao salvar OS: ${error.message}`, "error")
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar'
    }
  }
}

// =============================================================================
// Task modal
// =============================================================================

function bindTaskModalShell() {
  document.getElementById("taskModalOverlay")?.addEventListener("click", closeTaskModal)
  document.getElementById("taskAttachmentInput")?.addEventListener("change", handleAttachmentFileSelected)
}

function openTaskModal(task) {
  if (!task || !KB.currentOsDetail) return

  KB.currentTask = task
  KB.currentTaskTab = "task"
  KB.taskRegisterOpen = false
  KB.taskRegisterDraft = { duration: "", note: "" }
  KB.pendingAttachment = null

  document.getElementById("taskModalOverlay")?.classList.remove("hidden")
  document.getElementById("taskModal")?.classList.remove("hidden")
  renderTaskModal()
}

function closeTaskModal() {
  document.getElementById("taskModalOverlay")?.classList.add("hidden")
  document.getElementById("taskModal")?.classList.add("hidden")
  document.getElementById("taskModalHeader").innerHTML = ""
  document.getElementById("taskModalBody").innerHTML = ""
  document.getElementById("taskModalFooter").innerHTML = ""
  KB.currentTask = null
  KB.currentTaskTab = "task"
  KB.taskRegisterOpen = false
  KB.taskRegisterDraft = { duration: "", note: "" }
  KB.pendingAttachment = null
  KB.attachmentsLoading = false
}

function renderTaskModal() {
  if (!KB.currentTask || !KB.currentOsDetail) return

  const task = KB.currentTask
  const header = document.getElementById("taskModalHeader")
  const body = document.getElementById("taskModalBody")
  const footer = document.getElementById("taskModalFooter")
  if (!header || !body || !footer) return

  header.innerHTML = `
    <div class="task-modal-head-left">
      <button class="asset-drawer-back" id="taskModalBackBtn"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="task-modal-title">${esc(task.asset_name || "Ativo")}${task.asset_code ? ` { ${esc(task.asset_code)} }` : ""}</div>
    </div>
    <div class="task-modal-head-right">
      <button class="wz-btn-primary" id="taskModalSaveBtn"><i class="fa-solid fa-floppy-disk"></i></button>
    </div>
  `

  body.innerHTML = `
    <div class="task-tabs">
      ${renderTaskTabButton("task", "fa-solid fa-house", "Tarefa")}
      ${renderTaskTabButton("subtasks", "fa-solid fa-list", "SubTarefas")}
      ${renderTaskTabButton("resources", "fa-solid fa-screwdriver-wrench", "Recursos")}
      ${renderTaskTabButton("attachments", "fa-solid fa-paperclip", "Anexos")}
    </div>
    <div class="task-panel">
      ${renderTaskPanel(task)}
    </div>
  `

  footer.innerHTML = `
    ${KB.taskRegisterOpen ? renderTaskRegisterPanel() : ""}
    <div class="task-modal-footer-row">
      <button class="wz-btn-primary" id="taskStartBtn" ${task.status === "em_andamento" || task.status === "concluida" ? "disabled" : ""}>
        <i class="fa-solid fa-play"></i> ${task.status === "concluida" ? "Conclu\u00edda" : task.status === "em_andamento" ? "Em andamento" : "Come\u00e7ar"}
      </button>
      <button class="wz-btn-ghost" id="taskRegisterBtn"><i class="fa-solid fa-clipboard-list"></i> Registro</button>
    </div>
  `

  wireTaskModalInteractions()

  if (KB.currentTaskTab === "attachments" && !task.attachmentsLoaded && !KB.attachmentsLoading) {
    void loadTaskAttachments(task)
  }
}

function renderTaskTabButton(tab, icon, label) {
  return `
    <button type="button" class="task-tab ${KB.currentTaskTab === tab ? "active" : ""}" data-tab="${esc(tab)}">
      <i class="${esc(icon)}"></i>${esc(label)}
    </button>
  `
}

function renderTaskPanel(task) {
  if (KB.currentTaskTab === "subtasks") return renderTaskSubtasksPanel(task)
  if (KB.currentTaskTab === "resources") return renderTaskResourcesPanel(task)
  if (KB.currentTaskTab === "attachments") return renderTaskAttachmentsPanel(task)
  return renderTaskGeneralPanel(task)
}

function renderTaskGeneralPanel(task) {
  const criticality = formatCriticality(task.criticality)
  return `
    <section class="task-section">
      <div class="task-section-head">
        <div class="task-section-title">Geral</div>
      </div>
      <div class="task-task-name">${esc(task.name || "Sem nome")}</div>
      <div class="task-grid">
        <div class="task-field">
          <label>Tipo de tarefa</label>
          <div class="task-readonly">${esc(task.task_type || "---")}</div>
        </div>
        <div class="task-field">
          <label>Data programada</label>
          <div class="task-readonly">${esc(task.scheduled_date ? fmtDateLong(task.scheduled_date) : "---")}</div>
        </div>
        <div class="task-field">
          <label>Criticidade</label>
          <div class="task-readonly task-readonly--critical"><span class="task-criticality-dot ${esc(criticality.key)}"></span>${esc(criticality.label)}</div>
        </div>
        <div class="task-field">
          <label>Classifica\u00e7\u00e3o 1</label>
          <div class="task-readonly">${esc(task.classification_1 || "---")}</div>
        </div>
        <div class="task-field">
          <label>Classifica\u00e7\u00e3o 2</label>
          <div class="task-readonly">${esc(task.classification_2 || "---")}</div>
        </div>
        <div class="task-field">
          <label>Status</label>
          <div class="task-readonly">${esc(TASK_STATUS_LABELS[normalizeTaskStatus(task.status)] || normalizeTaskStatus(task.status))}</div>
        </div>
      </div>
    </section>

    <section class="task-section">
      <div class="task-section-title">Tempo</div>
      <div class="task-grid">
        <div class="task-field">
          <label>Duracao estimada</label>
          <div class="task-readonly">${esc(formatDurationLong(task.estimated_duration))}</div>
        </div>
        <div class="task-field">
          <label>Tempo de execucao</label>
          <div class="task-readonly">${esc(computeExecutionTime(task))}</div>
        </div>
        <div class="task-field">
          <label for="taskStartDate">Data inicial</label>
          <input id="taskStartDate" class="task-input" type="datetime-local" value="${esc(toDatetimeLocalInputValue(task.start_date))}" />
        </div>
        <div class="task-field">
          <label for="taskEndDate">Data final</label>
          <input id="taskEndDate" class="task-input" type="datetime-local" value="${esc(toDatetimeLocalInputValue(task.end_date))}" />
        </div>
      </div>
    </section>
  `
}

function renderTaskSubtasksPanel(task) {
  const subtasks = task.subtasks || []
  return `
    <section class="task-section">
      <div class="task-section-title">Procedimento</div>
      <textarea id="taskProcedureInput" class="task-textarea" placeholder="Descreva o que foi realizado em campo...">${esc(task.procedure || "")}</textarea>
    </section>
    <section class="task-section">
      <div class="task-section-title">Subtarefas</div>
      <div class="task-subtask-list">
        ${
          subtasks.length
            ? subtasks
                .map(
                  (item, index) => `
              <label class="task-subtask-item">
                <span class="task-subtask-check">
                  <input type="checkbox" data-subtask-index="${index}" ${item.done ? "checked" : ""} />
                    <span class="task-subtask-copy">
                      <span class="task-subtask-title">${esc(item.title || item.name || `Subtarefa ${index + 1}`)}</span>
                      <span class="task-subtask-status">${item.done ? "Conclu\u00edda" : "Pendente"}</span>
                    </span>
                  </span>
                </label>
            `
                )
                .join("")
            : '<div class="task-empty">Nenhuma subtarefa cadastrada.</div>'
        }
      </div>
    </section>
  `
}

function renderTaskResourcesPanel(task) {
  const resources = task.resources || []
  return `
    <section class="task-section">
      <div class="task-section-title">Recursos</div>
      <div class="task-resource-list">
        ${
          resources.length
            ? resources
                .map(
                  (resource) => `
              <div class="task-resource-item">
                <div class="task-resource-copy">
                  <div class="task-resource-name">${esc(resource.name || "Recurso")}</div>
                  <div class="task-resource-meta">Quantidade: ${esc(String(resource.quantity || 1))} | Status: ${esc(resource.status || "Planejado")}</div>
                </div>
              </div>
            `
                )
                .join("")
            : '<div class="task-empty">Nenhum recurso cadastrado.</div>'
        }
      </div>
    </section>
  `
}

function renderTaskAttachmentsPanel(task) {
  const pending = KB.pendingAttachment
  const attachments = task.attachments || []

  return `
    <section class="task-section">
      <div class="task-attachment-toolbar">
        <div class="task-section-title">Anexos</div>
        <button type="button" class="wz-btn-primary" id="taskAddAttachmentBtn"><i class="fa-solid fa-plus"></i> Adicionar anexo</button>
      </div>

      ${
        pending
          ? `
            <div class="task-attachment-pending">
              <div class="task-attachment-preview">
                ${
                  pending.preview && pending.isImage
                    ? `<img src="${pending.preview}" alt="Preview do anexo" />`
                    : `<i class="fa-solid ${pending.isImage ? "fa-image" : "fa-file-pdf"}"></i>`
                }
              </div>
              <div class="task-attachment-copy">
                <div class="task-attachment-name">${esc(pending.file.name)}</div>
                <div class="task-attachment-meta">${esc(formatBytes(pending.file.size))}</div>
                <textarea id="taskAttachmentNote" class="task-textarea" placeholder="Nota sobre este anexo">${esc(pending.note || "")}</textarea>
                ${
                  pending.uploading
                    ? `
                      <div class="upload-progress"><div class="upload-progress-fill" id="taskUploadProgressFill" style="width:${pending.progress || 0}%"></div></div>
                      <div class="task-attachment-meta" id="taskUploadProgressText">${pending.progress || 0}% enviado</div>
                    `
                    : ""
                }
                <div class="task-attachment-actions">
                  <button type="button" class="wz-btn-primary" id="taskConfirmAttachmentBtn" ${pending.uploading ? "disabled" : ""}>Confirmar upload</button>
                  <button type="button" class="wz-btn-ghost" id="taskCancelAttachmentBtn" ${pending.uploading ? "disabled" : ""}>Cancelar</button>
                </div>
              </div>
            </div>
          `
          : ""
      }

      <div class="task-attachment-list">
        ${
          KB.attachmentsLoading
            ? '<div class="task-empty"><span class="kb-spinner"></span><span>Carregando anexos...</span></div>'
            : attachments.length
            ? attachments.map((attachment) => renderAttachmentItem(attachment)).join("")
            : '<div class="task-empty">Nenhum anexo enviado ainda.</div>'
        }
      </div>
    </section>
  `
}

function renderAttachmentItem(attachment) {
  const iconClass = isImageAttachment(attachment) ? "fa-image" : "fa-file-pdf"
  const thumb = attachment.thumbnail_url || attachment.preview_url || attachment.url || ""
  const createdAt = attachment.created_at ? fmtDatetime(attachment.created_at) : "---"

  return `
    <div class="task-attachment-item">
      <a class="task-attachment-link" href="${escAttr(attachment.url || "#")}" ${attachment.url ? 'target="_blank" rel="noopener noreferrer"' : ""}>
        <div class="task-attachment-thumb">
          ${thumb && isImageAttachment(attachment) ? `<img src="${thumb}" alt="${escAttr(attachment.name)}" />` : `<i class="fa-solid ${iconClass}"></i>`}
        </div>
      </a>
      <div class="task-attachment-copy">
        <a class="task-attachment-link" href="${escAttr(attachment.url || "#")}" ${attachment.url ? 'target="_blank" rel="noopener noreferrer"' : ""}>
          <div class="task-attachment-name">${esc(attachment.name || "Arquivo")}</div>
        </a>
        <div class="task-attachment-meta">${esc(attachment.note || "Sem nota")}</div>
        <div class="task-attachment-meta">${esc(createdAt)}</div>
      </div>
      <button type="button" class="icon-btn task-attachment-delete" data-attachment-id="${esc(attachment.id)}" title="Excluir anexo"><i class="fa-solid fa-trash"></i></button>
    </div>
  `
}

function renderTaskRegisterPanel() {
  return `
    <div class="task-register-panel">
      <div class="task-field">
        <label for="taskRegisterDuration">Horas</label>
        <input id="taskRegisterDuration" class="task-input" type="text" placeholder="HH:MM" value="${esc(KB.taskRegisterDraft.duration || "")}" />
      </div>
      <div class="task-field">
        <label for="taskRegisterNote">Apontamento</label>
        <textarea id="taskRegisterNote" class="task-textarea" placeholder="Registre o apontamento de horas...">${esc(KB.taskRegisterDraft.note || "")}</textarea>
      </div>
      <div class="task-field">
        <label>&nbsp;</label>
        <button class="wz-btn-primary" id="taskRegisterSaveBtn">Salvar registro</button>
      </div>
    </div>
  `
}

function wireTaskModalInteractions() {
  document.getElementById("taskModalBackBtn")?.addEventListener("click", closeTaskModal)
  document.getElementById("taskModalSaveBtn")?.addEventListener("click", saveCurrentTask)
  document.getElementById("taskStartBtn")?.addEventListener("click", beginTaskExecution)
  document.getElementById("taskRegisterBtn")?.addEventListener("click", () => {
    KB.taskRegisterOpen = !KB.taskRegisterOpen
    renderTaskModal()
  })

  document.querySelectorAll(".task-tab[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      KB.currentTaskTab = button.dataset.tab
      renderTaskModal()
    })
  })

  document.getElementById("taskStartDate")?.addEventListener("change", (event) => {
    if (KB.currentTask) KB.currentTask.start_date = event.target.value || null
  })

  document.getElementById("taskEndDate")?.addEventListener("change", (event) => {
    if (KB.currentTask) KB.currentTask.end_date = event.target.value || null
  })

  document.getElementById("taskProcedureInput")?.addEventListener("input", (event) => {
    if (KB.currentTask) KB.currentTask.procedure = event.target.value
  })

  document.querySelectorAll("[data-subtask-index]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      if (!KB.currentTask) return
      const index = Number(event.target.dataset.subtaskIndex)
      const subtask = KB.currentTask.subtasks[index]
      if (!subtask) return
      subtask.done = !!event.target.checked
      KB.currentTask.progress = getProgressValue(KB.currentTask)
      syncPrimaryTaskToDetail(KB.currentOsDetail)
      renderTaskModal()
      renderOsDetail(KB.currentOsDetail)
    })
  })

  document.getElementById("taskAddAttachmentBtn")?.addEventListener("click", () => {
    document.getElementById("taskAttachmentInput")?.click()
  })

  document.getElementById("taskAttachmentNote")?.addEventListener("input", (event) => {
    if (KB.pendingAttachment) KB.pendingAttachment.note = event.target.value
  })

  document.getElementById("taskConfirmAttachmentBtn")?.addEventListener("click", confirmAttachmentUpload)
  document.getElementById("taskCancelAttachmentBtn")?.addEventListener("click", () => {
    KB.pendingAttachment = null
    renderTaskModal()
  })

  document.getElementById("taskRegisterDuration")?.addEventListener("input", (event) => {
    KB.taskRegisterDraft.duration = event.target.value
  })

  document.getElementById("taskRegisterNote")?.addEventListener("input", (event) => {
    KB.taskRegisterDraft.note = event.target.value
  })

  document.getElementById("taskRegisterSaveBtn")?.addEventListener("click", saveTaskRegister)

  document.querySelectorAll("[data-attachment-id]").forEach((button) => {
    button.addEventListener("click", () => deleteAttachment(button.dataset.attachmentId))
  })
}

function syncCurrentTaskDraftFromForm() {
  if (!KB.currentTask) return

  const startDate = document.getElementById("taskStartDate")
  const endDate = document.getElementById("taskEndDate")
  const procedure = document.getElementById("taskProcedureInput")

  if (startDate) KB.currentTask.start_date = startDate.value || null
  if (endDate) KB.currentTask.end_date = endDate.value || null
  if (procedure) KB.currentTask.procedure = procedure.value || ""
}

async function saveCurrentTask() {
  if (!KB.currentTask || !KB.currentOsDetail) return

  syncCurrentTaskDraftFromForm()
  syncPrimaryTaskToDetail(KB.currentOsDetail)
  await persistWorkOrderDetail(KB.currentOsDetail, "Tarefa atualizada com sucesso")
}

async function beginTaskExecution() {
  if (!KB.currentTask || !KB.currentOsDetail) return

  syncCurrentTaskDraftFromForm()
  if (!KB.currentTask.start_date) KB.currentTask.start_date = new Date().toISOString()
  KB.currentTask.status = "em_andamento"
  if (KB.currentOsDetail.status === "pendente") KB.currentOsDetail.status = "em_processo"
  syncPrimaryTaskToDetail(KB.currentOsDetail)

  await persistWorkOrderDetail(KB.currentOsDetail, "Tarefa iniciada")
}

async function saveTaskRegister() {
  if (!KB.currentTask || !KB.currentOsDetail) return

  const duration = (KB.taskRegisterDraft.duration || "").trim()
  if (!duration) {
    showToast("Informe a quantidade de horas do registro", "error")
    return
  }

  const logEntry = {
    id: Date.now(),
    duration,
    note: (KB.taskRegisterDraft.note || "").trim(),
    created_at: new Date().toISOString()
  }

  if (!Array.isArray(KB.currentTask.execution_logs)) KB.currentTask.execution_logs = []
  KB.currentTask.execution_logs.push(logEntry)

  if (!KB.currentTask.start_date) KB.currentTask.start_date = new Date().toISOString()
  if (KB.currentTask.status === "nao_iniciada") KB.currentTask.status = "em_andamento"
  if (KB.currentOsDetail.status === "pendente") KB.currentOsDetail.status = "em_processo"

  KB.taskRegisterOpen = false
  KB.taskRegisterDraft = { duration: "", note: "" }
  syncPrimaryTaskToDetail(KB.currentOsDetail)

  await persistWorkOrderDetail(KB.currentOsDetail, "Registro salvo com sucesso")
}

function handleAttachmentFileSelected(event) {
  const file = event.target.files?.[0]
  event.target.value = ""
  if (!file) return

  KB.pendingAttachment = {
    file,
    note: "",
    preview: "",
    isImage: file.type.startsWith("image/"),
    uploading: false,
    progress: 0
  }

  if (KB.pendingAttachment.isImage) {
    const reader = new FileReader()
    reader.onload = () => {
      if (KB.pendingAttachment && KB.pendingAttachment.file === file) {
        KB.pendingAttachment.preview = typeof reader.result === "string" ? reader.result : ""
        renderTaskModal()
      }
    }
    reader.readAsDataURL(file)
  }

  renderTaskModal()
}

async function confirmAttachmentUpload() {
  if (!KB.pendingAttachment || !KB.currentOsDetail || !KB.currentTask) return

  KB.pendingAttachment.uploading = true
  KB.pendingAttachment.progress = 0
  renderTaskModal()

  try {
    const workOrderId = getWorkOrderId(KB.currentOsDetail)
    await uploadWorkOrderAttachment(workOrderId, KB.pendingAttachment, (progress) => {
      KB.pendingAttachment.progress = progress
      const fill = document.getElementById("taskUploadProgressFill")
      const text = document.getElementById("taskUploadProgressText")
      if (fill) fill.style.width = `${progress}%`
      if (text) text.textContent = `${progress}% enviado`
    })

    showToast("Anexo enviado com sucesso", "success")
    KB.pendingAttachment = null
    KB.currentTask.attachmentsLoaded = false
    KB.currentTaskTab = "attachments"
    await refreshCurrentWorkOrderDetail({ preserveTaskId: KB.currentTask.id })
  } catch (error) {
    console.error("[OS] upload attachment", error)
    KB.pendingAttachment.uploading = false
    showToast(`Erro ao enviar anexo: ${error.message}`, "error")
    renderTaskModal()
  }
}

async function uploadWorkOrderAttachment(workOrderId, pendingAttachment, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${getApiBase()}/work-orders/${workOrderId}/attachments`)

    const headers = apiUserHeaders()
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value))

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return
      const progress = Math.round((event.loaded / event.total) * 100)
      onProgress(progress)
    })

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300
      if (!ok) {
        let message = `HTTP ${xhr.status}`
        try {
          const parsed = JSON.parse(xhr.responseText || "{}")
          message = parsed.error || parsed.message || message
        } catch (_error) {}
        reject(new Error(message))
        return
      }

      try {
        resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null)
      } catch (_error) {
        resolve(null)
      }
    }

    xhr.onerror = () => reject(new Error("Falha de rede durante o upload"))

    const formData = new FormData()
    formData.append("file", pendingAttachment.file)
    formData.append("note", pendingAttachment.note || "")
    xhr.send(formData)
  })
}

async function loadTaskAttachments(task) {
  if (!task || !KB.currentOsDetail) return

  KB.attachmentsLoading = true
  renderTaskModal()

  try {
    const data = await apiJson(`/work-orders/${getWorkOrderId(KB.currentOsDetail)}/attachments`)
    const items = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.attachments)
      ? data.attachments
      : Array.isArray(data)
      ? data
      : []

    task.attachments = normalizeAttachments(items)
    task.attachmentsLoaded = true
    syncPrimaryTaskToDetail(KB.currentOsDetail)
  } catch (error) {
    console.warn("[OS] attachments fallback", error)
    task.attachmentsLoaded = true
  } finally {
    KB.attachmentsLoading = false
    renderTaskModal()
  }
}

async function deleteAttachment(attachmentId) {
  if (!attachmentId || !KB.currentOsDetail || !KB.currentTask) return
  if (!window.confirm("Deseja excluir este anexo?")) return

  try {
    await apiJson(`/work-orders/${getWorkOrderId(KB.currentOsDetail)}/attachments/${attachmentId}`, {
      method: "DELETE"
    })

    KB.currentTask.attachments = (KB.currentTask.attachments || []).filter(
      (attachment) => String(attachment.id) !== String(attachmentId)
    )
    syncPrimaryTaskToDetail(KB.currentOsDetail)
    renderTaskModal()
    renderOsDetail(KB.currentOsDetail)
    showToast("Anexo removido com sucesso", "success")
  } catch (error) {
    console.error("[OS] delete attachment", error)
    showToast(`Erro ao excluir anexo: ${error.message}`, "error")
  }
}

// =============================================================================
// FAB / wizard
// =============================================================================

function bindFab() {
  document.getElementById("kbFab")?.addEventListener("click", openWizard)
}

function bindWizard() {
  document.getElementById("wzCloseBtn")?.addEventListener("click", closeWizard)
  document.getElementById("wzCancelBtn")?.addEventListener("click", closeWizard)
  document.getElementById("wzBackBtn")?.addEventListener("click", () => goToStep(KB.currentStep - 1))
  document.getElementById("wzPrevBtn")?.addEventListener("click", () => goToStep(KB.currentStep - 1))
  document.getElementById("wzNextBtn")?.addEventListener("click", () => goToStep(KB.currentStep + 1))
  document.getElementById("wzSubmitBtn")?.addEventListener("click", submitWizard)

  document.getElementById("failedCheckLabel")?.addEventListener("click", () => {
    KB.failedChecked = !KB.failedChecked
    document.getElementById("failedCheck")?.classList.toggle("checked", KB.failedChecked)
    document.getElementById("failureFields")?.classList.toggle("hidden", !KB.failedChecked)
  })

  document.getElementById("serviceCheckLabel")?.addEventListener("click", () => {
    KB.serviceChecked = !KB.serviceChecked
    document.getElementById("serviceCheck")?.classList.toggle("checked", KB.serviceChecked)
  })

  document.getElementById("alreadyDoneLabel")?.addEventListener("click", () => {
    KB.alreadyDoneChecked = !KB.alreadyDoneChecked
    document.getElementById("alreadyDoneCheck")?.classList.toggle("checked", KB.alreadyDoneChecked)
    document.getElementById("radioGroupNormal")?.classList.toggle("hidden", KB.alreadyDoneChecked)
    document.getElementById("radioGroupDone")?.classList.toggle("hidden", !KB.alreadyDoneChecked)
    document.getElementById("responsavelGroup")?.classList.toggle("hidden", !KB.alreadyDoneChecked)
  })

  document.getElementById("addSubtaskBtn")?.addEventListener("click", addSubtask)
  document.getElementById("addResourceBtn")?.addEventListener("click", addResource)
}

function openWizard() {
  resetWizard()
  document.getElementById("wzOverlay")?.classList.remove("hidden")

  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  document.getElementById("f-incident-date").value = local
  document.getElementById("f-scheduled-date").value = local
  document.getElementById("f-start-date").value = local
}

function closeWizard() {
  document.getElementById("wzOverlay")?.classList.add("hidden")
}

function resetWizard() {
  KB.currentStep = 1
  KB.selectedAsset = null
  KB.selectedResponsavel = null
  KB.subtasks = []
  KB.resources = []
  KB.failedChecked = false
  KB.serviceChecked = false
  KB.alreadyDoneChecked = false

  ;["f-task-desc", "f-observation", "f-request-num"].forEach((id) => {
    const element = document.getElementById(id)
    if (element) element.value = ""
  })

  document.getElementById("f-duration").value = "000:10"
  document.getElementById("f-interruption-duration").value = "000:00"

  ;[
    "f-failure-type",
    "f-failure-cause",
    "f-detection-method",
    "f-failure-severity",
    "f-task-type",
    "f-class1",
    "f-class2"
  ].forEach((id) => {
    const element = document.getElementById(id)
    if (element) element.value = ""
  })

  document.getElementById("f-criticality").value = ""
  document.getElementById("f-damage-type").value = "Nenhum"

  ;["failedCheck", "serviceCheck", "alreadyDoneCheck"].forEach((id) => {
    document.getElementById(id)?.classList.remove("checked")
  })

  document.getElementById("failureFields")?.classList.add("hidden")
  document.getElementById("radioGroupNormal")?.classList.remove("hidden")
  document.getElementById("radioGroupDone")?.classList.add("hidden")
  document.getElementById("responsavelGroup")?.classList.add("hidden")
  document.getElementById("assetSelected")?.classList.add("hidden")
  document.getElementById("assetSearchBtn")?.classList.remove("hidden")

  const respLabel = document.getElementById("responsavelBtnLabel")
  if (respLabel) respLabel.textContent = "Selecionar respons\u00e1vel..."

  document.getElementById("sendToPending").checked = true
  document.getElementById("subtasksList").innerHTML =
    '<div class="wz-subtasks-empty"><i class="fa-regular fa-circle-check"></i><span>Nenhuma subtarefa adicionada</span></div>'
  document.getElementById("resourcesList").innerHTML =
    '<div class="wz-subtasks-empty"><i class="fa-regular fa-toolbox"></i><span>Nenhum recurso adicionado</span></div>'
  document.querySelectorAll(".wz-error").forEach((element) => element.classList.add("hidden"))

  goToStep(1, true)
}

function goToStep(step, force = false) {
  if (step < 1 || step > 4) return
  if (!force && step > KB.currentStep && !validateStep(KB.currentStep)) return

  KB.currentStep = step

  for (let index = 1; index <= 4; index += 1) {
    document.getElementById(`wz-step-${index}`)?.classList.toggle("hidden", index !== step)
  }

  document.querySelectorAll(".wz-step[data-step]").forEach((element) => {
    const current = Number(element.dataset.step)
    element.classList.toggle("active", current === step)
    element.classList.toggle("done", current < step)
  })

  document.getElementById("wzBackBtn")?.classList.toggle("hidden", step <= 1)
  document.getElementById("wzPrevBtn")?.classList.toggle("hidden", step <= 1)
  document.getElementById("wzNextBtn")?.classList.toggle("hidden", step >= 4)
  document.getElementById("wzSubmitBtn")?.classList.toggle("hidden", step < 4)

  if (step === 4) buildSummary()
}

function validateStep(step) {
  let ok = true

  if (step === 1) {
    if (!KB.selectedAsset) {
      document.getElementById("err-asset")?.classList.remove("hidden")
      document.getElementById("assetSearchBtn")?.classList.add("has-error")
      ok = false
    }

    if (KB.failedChecked) {
      ;["f-failure-type", "f-failure-cause", "f-detection-method"].forEach((id) => {
        const element = document.getElementById(id)
        if (!element?.value) {
          document.getElementById(id.replace("f-", "err-"))?.classList.remove("hidden")
          ok = false
        }
      })
    }
  }

  if (step === 2) {
    const description = document.getElementById("f-task-desc")?.value?.trim()
    if (!description) {
      document.getElementById("err-task-desc")?.classList.remove("hidden")
      ok = false
    }

    const taskType = document.getElementById("f-task-type")?.value
    if (!taskType) {
      document.getElementById("err-task-type")?.classList.remove("hidden")
      ok = false
    }

    if (KB.alreadyDoneChecked && !KB.selectedResponsavel) {
      document.getElementById("err-responsavel")?.classList.remove("hidden")
      ok = false
    }
  }

  return ok
}

function buildSummary() {
  const grid = document.getElementById("wzSummaryGrid")
  if (!grid) return

  const sendTo = KB.alreadyDoneChecked
    ? document.getElementById("sendToVerif")?.checked
      ? "Verificacao"
      : "Finalizados"
    : document.getElementById("sendToPending")?.checked
    ? "Tarefas pendentes"
    : "OSs em Processo"

  const items = [
    ["Ativo", KB.selectedAsset?.name || "---"],
    ["Codigo", KB.selectedAsset?.code || "---"],
    ["Incidente", document.getElementById("f-incident-date")?.value || "---"],
    ["Ativo falhou?", KB.failedChecked ? "Sim" : "Nao"],
    ["Tipo tarefa", document.getElementById("f-task-type")?.value || "---"],
    ["Classifica\u00e7\u00e3o 1", document.getElementById("f-class1")?.value || "---"],
    ["Classifica\u00e7\u00e3o 2", document.getElementById("f-class2")?.value || "---"],
    ["Responsavel", KB.selectedResponsavel?.name || "---"],
    ["Enviar para", sendTo],
    ["Subtarefas", String(KB.subtasks.filter(Boolean).length)]
  ]

  grid.innerHTML = items
    .map(
      ([key, value]) =>
        `<div class="wz-summary-item"><span class="wz-summary-key">${esc(key)}</span><span class="wz-summary-val">${esc(value)}</span></div>`
    )
    .join("")
}

async function submitWizard() {
  if (!validateStep(1) || !validateStep(2)) {
    showToast("Preencha os campos obrigatorios", "error")
    return
  }

  const submitBtn = document.getElementById("wzSubmitBtn")
  submitBtn.disabled = true
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...'

  let sendStatus
  if (KB.alreadyDoneChecked) {
    sendStatus = document.getElementById("sendToVerif")?.checked ? "em_verificacao" : "concluida"
  } else {
    sendStatus = document.getElementById("sendToPending")?.checked ? "pendente" : "em_processo"
  }

  const body = {
    asset_id: KB.selectedAsset?.id || null,
    asset_name: KB.selectedAsset?.name || null,
    asset_code: KB.selectedAsset?.code || null,
    asset_location: KB.selectedAsset?.location || null,
    plant_id: KB.selectedAsset?.plant_id || null,
    incident_date: document.getElementById("f-incident-date")?.value || new Date().toISOString(),
    requested_by: document.getElementById("f-requested-by")?.value || null,
    asset_failed: KB.failedChecked,
    failure_type: KB.failedChecked ? document.getElementById("f-failure-type")?.value : null,
    failure_cause: KB.failedChecked ? document.getElementById("f-failure-cause")?.value : null,
    failure_detection_method: KB.failedChecked ? document.getElementById("f-detection-method")?.value : null,
    failure_severity: KB.failedChecked ? document.getElementById("f-failure-severity")?.value : null,
    damage_type: KB.failedChecked ? document.getElementById("f-damage-type")?.value : "Nenhum",
    caused_interruption_duration: KB.failedChecked ? document.getElementById("f-interruption-duration")?.value : "000:00",
    back_to_service: KB.serviceChecked,
    task_description: document.getElementById("f-task-desc")?.value?.trim(),
    observations: document.getElementById("f-observation")?.value?.trim() || null,
    task_type: document.getElementById("f-task-type")?.value,
    classification_1: document.getElementById("f-class1")?.value || null,
    classification_2: document.getElementById("f-class2")?.value || null,
    criticality: document.getElementById("f-criticality")?.value || "media",
    estimated_duration: document.getElementById("f-duration")?.value || "000:10",
    request_number: document.getElementById("f-request-num")?.value?.trim() || null,
    already_performed: KB.alreadyDoneChecked,
    responsavel_id: KB.selectedResponsavel?.id || null,
    responsavel_name: KB.selectedResponsavel?.name || null,
    responsavel_email: KB.selectedResponsavel?.email || null,
    status: sendStatus,
    scheduled_date: document.getElementById("f-scheduled-date")?.value || null,
    start_date: document.getElementById("f-start-date")?.value || null,
    subtasks: KB.subtasks.filter(Boolean),
    resources: KB.resources.filter(Boolean)
  }

  try {
    await apiJson("/work-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })

    closeWizard()
    showToast(STATUS_CREATE_TOAST[sendStatus] || "Uma nova OS foi gerada", "success")
    await refreshColumns([sendStatus])
  } catch (error) {
    console.error("[WZ] submit", error)
    showToast(`Erro ao criar OS: ${error.message}`, "error")
  } finally {
    submitBtn.disabled = false
    submitBtn.innerHTML =
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="4 10 8 14 16 6"/></svg> Gerar OS'
  }
}

function addSubtask() {
  const list = document.getElementById("subtasksList")
  list.querySelector(".wz-subtasks-empty")?.remove()

  const index = KB.subtasks.length
  KB.subtasks.push("")

  const item = document.createElement("div")
  item.className = "wz-subtask-item"
  item.innerHTML =
    '<i class="fa-regular fa-circle-check" style="color:var(--text-muted);font-size:14px;"></i><input type="text" placeholder="Descricao da subtarefa..." /><button class="wz-subtask-remove"><i class="fa-solid fa-xmark"></i></button>'

  const input = item.querySelector("input")
  input.addEventListener("input", () => {
    KB.subtasks[index] = input.value
  })

  item.querySelector(".wz-subtask-remove").addEventListener("click", () => {
    KB.subtasks[index] = null
    item.remove()
    if (!list.querySelector(".wz-subtask-item")) {
      list.innerHTML =
        '<div class="wz-subtasks-empty"><i class="fa-regular fa-circle-check"></i><span>Nenhuma subtarefa adicionada</span></div>'
    }
  })

  list.appendChild(item)
  input.focus()
}

function addResource() {
  const list = document.getElementById("resourcesList")
  list.querySelector(".wz-subtasks-empty")?.remove()

  const index = KB.resources.length
  KB.resources.push("")

  const item = document.createElement("div")
  item.className = "wz-resource-item"
  item.innerHTML =
    '<i class="fa-solid fa-wrench" style="color:var(--text-muted);font-size:13px;"></i><input type="text" placeholder="Nome do recurso..." /><button class="wz-subtask-remove"><i class="fa-solid fa-xmark"></i></button>'

  const input = item.querySelector("input")
  input.addEventListener("input", () => {
    KB.resources[index] = input.value
  })

  item.querySelector(".wz-subtask-remove").addEventListener("click", () => {
    KB.resources[index] = null
    item.remove()
    if (!list.querySelector(".wz-resource-item")) {
      list.innerHTML =
        '<div class="wz-subtasks-empty"><i class="fa-regular fa-toolbox"></i><span>Nenhum recurso adicionado</span></div>'
    }
  })

  list.appendChild(item)
  input.focus()
}

// =============================================================================
// Asset drawer
// =============================================================================

function bindAssetDrawer() {
  document.getElementById("assetSearchBtn")?.addEventListener("click", openAssetDrawer)
  document.getElementById("assetDrawerBack")?.addEventListener("click", closeAssetDrawer)
  document.getElementById("assetDrawerOverlay")?.addEventListener("click", closeAssetDrawer)
  document.getElementById("assetClearBtn")?.addEventListener("click", clearAsset)
  document.getElementById("assetFilterToggle")?.addEventListener("click", () => {
    document.getElementById("assetFilterPanel")?.classList.remove("hidden")
  })
  document.getElementById("assetFilterBack")?.addEventListener("click", () => {
    document.getElementById("assetFilterPanel")?.classList.add("hidden")
  })
  document.getElementById("afpApplyBtn")?.addEventListener("click", () => {
    KB.assetFilters = {
      location: document.getElementById("flt-location")?.value || "",
      asset_type: document.getElementById("flt-asset-type")?.value || "",
      code: document.getElementById("flt-code")?.value || "",
      criticality: document.getElementById("flt-criticality")?.value || ""
    }
    document.getElementById("assetFilterPanel")?.classList.add("hidden")
    searchAssets()
  })

  document.getElementById("afpClearBtn")?.addEventListener("click", () => {
    KB.assetFilters = {}
    ;["flt-location", "flt-asset-type", "flt-desc", "flt-code", "flt-unit", "flt-barcode", "flt-criticality", "flt-type"].forEach((id) => {
      const element = document.getElementById(id)
      if (element) element.value = ""
    })
    document.getElementById("assetFilterPanel")?.classList.add("hidden")
    searchAssets()
  })

  document.getElementById("assetSearchInput")?.addEventListener("input", (event) => {
    KB.assetSearch = event.target.value
    clearTimeout(KB._assetTimer)
    KB._assetTimer = setTimeout(searchAssets, 350)
  })
}

function openAssetDrawer() {
  document.getElementById("assetDrawerOverlay")?.classList.remove("hidden")
  document.getElementById("assetDrawer")?.classList.remove("hidden")
  document.getElementById("assetFilterPanel")?.classList.add("hidden")
  KB.assetSearch = ""
  KB.assetFilters = {}
  const input = document.getElementById("assetSearchInput")
  if (input) input.value = ""
  searchAssets()
}

function closeAssetDrawer() {
  document.getElementById("assetDrawerOverlay")?.classList.add("hidden")
  document.getElementById("assetDrawer")?.classList.add("hidden")
}

function clearAsset() {
  KB.selectedAsset = null
  document.getElementById("assetSelected")?.classList.add("hidden")
  document.getElementById("assetSearchBtn")?.classList.remove("hidden")
}

async function searchAssets() {
  const loading = document.getElementById("assetLoading")
  const empty = document.getElementById("assetEmpty")
  const list = document.getElementById("assetResultsList")
  const footer = document.getElementById("assetResultsFooter")

  loading?.classList.remove("hidden")
  empty?.classList.add("hidden")
  if (list) list.innerHTML = ""
  if (footer) footer.textContent = ""

  const params = new URLSearchParams({ page: "1", page_size: "50" })
  if (KB.assetSearch) params.set("q", KB.assetSearch)
  Object.entries(KB.assetFilters).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })

  try {
    const data = await apiJson(`/assets?${params.toString()}`)
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.assets) ? data.assets : []
    loading?.classList.add("hidden")

    if (!items.length) {
      empty?.classList.remove("hidden")
      return
    }

    items.forEach((asset) => {
      const element = document.createElement("div")
      element.className = "asset-item"
      element.innerHTML = `
        <div class="asset-item-icon"><i class="fa-solid fa-microchip"></i></div>
        <div class="asset-item-body">
          <div class="asset-item-name">${esc(asset.name || asset.description)}</div>
          <div class="asset-item-code">${esc(asset.code || asset.asset_code || "")}</div>
          <div class="asset-item-meta">
            <div class="asset-meta-row"><span>Tipo:</span><span>${esc(asset.asset_type || "Instalacoes")}</span></div>
            <div class="asset-meta-row"><span>Local:</span><span>${esc(asset.location || asset.plant_name || "---")}</span></div>
            ${asset.criticality ? `<div class="asset-meta-row"><span>Criticidade:</span><span>${esc(asset.criticality)}</span></div>` : ""}
          </div>
        </div>
      `
      element.addEventListener("click", () => selectAsset(asset))
      list?.appendChild(element)
    })

    if (footer) footer.textContent = `Mostrando ${items.length} de ${data?.total || items.length}`
  } catch (error) {
    console.error("[OS] search assets", error)
    loading?.classList.add("hidden")
    if (list) {
      list.innerHTML =
        '<div class="asset-empty"><i class="fa-solid fa-triangle-exclamation"></i><span>Erro ao buscar ativos</span></div>'
    }
  }
}

function selectAsset(asset) {
  KB.selectedAsset = {
    id: asset.id || asset.device_id,
    name: asset.name || asset.description,
    code: asset.code || asset.asset_code,
    location: asset.location || asset.plant_name,
    plant_id: asset.plant_id
  }

  document.getElementById("assetSelected")?.classList.remove("hidden")
  document.getElementById("assetSearchBtn")?.classList.add("hidden")
  document.getElementById("assetSelectedName").textContent = `${KB.selectedAsset.name}${KB.selectedAsset.code ? ` { ${KB.selectedAsset.code} }` : ""}`
  document.getElementById("err-asset")?.classList.add("hidden")
  document.getElementById("assetSearchBtn")?.classList.remove("has-error")
  closeAssetDrawer()
}

// =============================================================================
// Responsavel drawer
// =============================================================================

function bindRespDrawer() {
  document.getElementById("responsavelBtn")?.addEventListener("click", openRespDrawer)
  document.getElementById("respDrawerBack")?.addEventListener("click", closeRespDrawer)
  document.getElementById("respDrawerOverlay")?.addEventListener("click", closeRespDrawer)

  document.getElementById("respSearchInput")?.addEventListener("input", (event) => {
    clearTimeout(KB._respTimer)
    KB._respTimer = setTimeout(() => filterRespTable(event.target.value), 250)
  })

  document.getElementById("respSearchClear")?.addEventListener("click", () => {
    const input = document.getElementById("respSearchInput")
    if (input) input.value = ""
    filterRespTable("")
  })

  document.getElementById("respDatePicker")?.addEventListener("change", loadRespUsers)
}

function openRespDrawer() {
  document.getElementById("respDrawerOverlay")?.classList.remove("hidden")
  document.getElementById("respDrawer")?.classList.remove("hidden")

  const today = new Date().toISOString().split("T")[0]
  const picker = document.getElementById("respDatePicker")
  if (picker && !picker.value) picker.value = today

  if (!KB.respUsers.length) loadRespUsers()
  else filterRespTable(document.getElementById("respSearchInput")?.value || "")
}

function closeRespDrawer() {
  document.getElementById("respDrawerOverlay")?.classList.add("hidden")
  document.getElementById("respDrawer")?.classList.add("hidden")
}

async function loadRespUsers() {
  const tbody = document.getElementById("respTableBody")
  if (tbody) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);"><span class="kb-spinner" style="display:inline-block;vertical-align:middle;margin-right:8px;"></span>Carregando...</td></tr>'
  }

  try {
    const date = document.getElementById("respDatePicker")?.value || new Date().toISOString().split("T")[0]
    const data = await apiJson(`/users?date=${encodeURIComponent(date)}`)
    const users = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : []
    KB.respUsers = users
    filterRespTable(document.getElementById("respSearchInput")?.value || "")
  } catch (error) {
    console.warn("[RESP] load", error)
    KB.respUsers = []
    renderRespTable([], 0)
  }
}

function renderRespTable(users, totalCount = users.length) {
  const tbody = document.getElementById("respTableBody")
  const meta = document.getElementById("respResultsMeta")
  if (!tbody) return

  if (!users.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted);">Nenhum respons\u00e1vel encontrado</td></tr>'
    if (meta) meta.textContent = `Mostrando 0 de ${totalCount}`
    return
  }

  tbody.innerHTML = users
    .map((user) => {
      const userId = user.id || user.user_id || ""
      const isSelected = String(KB.selectedResponsavel?.id || "") === String(userId)
      const dayCells = WEEK_DAY_COLUMNS.map((dayColumn) => {
        const value = resolveUserWeekHoursValue(user, dayColumn)
        const hasHours = hasHoursBadgeValue(value)
        const className = hasHours ? "resp-hours-cell has-hours" : "resp-hours-cell"
        return `<td><span class="${className}">${esc(hasHours ? value : "SEM HORAS")}</span></td>`
      }).join("")

      return `
        <tr class="${isSelected ? "selected" : ""}" data-user-id="${esc(userId)}" data-user-name="${escAttr(user.name || user.username || "")}" data-user-email="${escAttr(user.email || "")}" data-user-code="${escAttr(user.code || userId || "")}">
          <td style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--text-muted);">${esc(user.code || user.id || "---")}</td>
          <td>${esc(user.name || user.username || "---")}</td>
          <td style="font-size:11px;color:var(--text-muted);">${esc(user.email || "---")}</td>
          ${dayCells}
        </tr>
      `
    })
    .join("")

  if (meta) meta.textContent = `Mostrando ${users.length} de ${totalCount}`

  tbody.querySelectorAll("tr[data-user-id]").forEach((row) => {
    row.addEventListener("click", () => {
      tbody.querySelectorAll("tr").forEach((item) => item.classList.remove("selected"))
      row.classList.add("selected")
      selectResponsavel({
        id: row.dataset.userId,
        name: row.dataset.userName,
        email: row.dataset.userEmail,
        code: row.dataset.userCode
      })
    })
  })
}

function filterRespTable(query) {
  const normalizedQuery = (query || "").trim().toLowerCase()
  const filtered = !normalizedQuery
    ? KB.respUsers
    : KB.respUsers.filter((user) => {
        const search = `${user.name || user.username || ""} ${user.email || ""} ${user.code || ""}`.toLowerCase()
        return search.includes(normalizedQuery)
      })

  renderRespTable(filtered, KB.respUsers.length)
}

function selectResponsavel(user) {
  KB.selectedResponsavel = user
  const label = document.getElementById("responsavelBtnLabel")
  if (label) label.textContent = user.name
  document.getElementById("err-responsavel")?.classList.add("hidden")
  closeRespDrawer()
}

// =============================================================================
// Normalization and helpers
// =============================================================================

function normalizeWorkOrderList(data) {
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
  return items.map((item) => normalizeWorkOrderDetail(item))
}

function normalizeWorkOrderDetail(raw) {
  const detail = { ...(raw || {}) }
  const rawAttachments = raw?.attachments || raw?.files
  detail.id = getWorkOrderId(detail)
  detail.os_number = detail.os_number || detail.order_number || detail.id
  detail.status = detail.status || "pendente"
  detail.total_cost = toNumber(detail.total_cost ?? detail.cost_total ?? detail.cost ?? 0) || 0
  detail.responsavel_name = detail.responsavel_name || detail.assignee_name || detail.requested_by || ""
  detail.subtasks = normalizeSubtasks(detail.subtasks)
  detail.resources = normalizeResources(detail.resources)
  detail.attachments = normalizeAttachments(rawAttachments)
  detail.attachmentsLoaded = Array.isArray(rawAttachments)
  detail.tasks = normalizeTasks(detail)
  syncPrimaryTaskToDetail(detail)
  detail.progress = getProgressValue(detail)
  return detail
}

function normalizeTasks(detail) {
  const rawTasks =
    pickArray(detail.tasks) ||
    pickArray(detail.task_list) ||
    pickArray(detail.items) ||
    pickArray(detail.work_order_tasks) ||
    null

  const source = rawTasks || [detail]
  return source.map((item, index) => normalizeTask(item, detail, index)).filter(Boolean)
}

function normalizeTask(rawTask, detail, index) {
  const task = { ...(rawTask || {}) }
  const rawTaskAttachments = task.attachments
  const subtasks = normalizeSubtasks(task.subtasks ?? detail.subtasks)
  const resources = normalizeResources(task.resources ?? detail.resources)
  const attachments = normalizeAttachments(rawTaskAttachments ?? detail.attachments)
  const status = normalizeTaskStatus(task.status || task.task_status || detail.task_status || detail.status)

  return {
    id: task.id || task.task_id || `${detail.id || "task"}-${index + 1}`,
    work_order_id: detail.id,
    asset_name: task.asset_name || detail.asset_name || "Ativo sem nome",
    asset_code: task.asset_code || detail.asset_code || detail.asset_location || "",
    asset_location: task.asset_location || detail.asset_location || detail.plant_name || "",
    name: task.name || task.title || task.task_description || detail.task_description || `Tarefa ${index + 1}`,
    description: task.description || task.task_description || detail.task_description || "",
    task_type: task.task_type || detail.task_type || "",
    criticality: task.criticality || detail.criticality || "media",
    classification_1: task.classification_1 || detail.classification_1 || "",
    classification_2: task.classification_2 || detail.classification_2 || "",
    request_number: task.request_number || detail.request_number || "",
    estimated_duration: task.estimated_duration || detail.estimated_duration || "",
    scheduled_date: task.scheduled_date || detail.scheduled_date || detail.incident_date || "",
    start_date: task.start_date || detail.start_date || "",
    end_date: task.end_date || detail.end_date || "",
    procedure: task.procedure || detail.procedure || "",
    execution_logs: Array.isArray(task.execution_logs) ? task.execution_logs : Array.isArray(detail.execution_logs) ? detail.execution_logs : [],
    status,
    subtasks,
    resources,
    attachments,
    attachmentsLoaded: Array.isArray(rawTaskAttachments) || !!detail.attachmentsLoaded,
    progress: getProgressValue({ progress: task.progress, status, subtasks })
  }
}

function normalizeSubtasks(value) {
  const items = Array.isArray(value) ? value : []
  return items
    .map((item, index) => {
      if (item == null) return null
      if (typeof item === "string") {
        return { id: `subtask-${index + 1}`, title: item, done: false }
      }

      return {
        id: item.id || item.subtask_id || `subtask-${index + 1}`,
        title: item.title || item.description || item.name || `Subtarefa ${index + 1}`,
        done: !!(item.done ?? item.completed ?? item.is_done)
      }
    })
    .filter(Boolean)
}

function normalizeResources(value) {
  const items = Array.isArray(value) ? value : []
  return items
    .map((item, index) => {
      if (item == null) return null
      if (typeof item === "string") {
        return { id: `resource-${index + 1}`, name: item, quantity: 1, status: "Planejado" }
      }

      return {
        id: item.id || item.resource_id || `resource-${index + 1}`,
        name: item.name || item.resource_name || `Recurso ${index + 1}`,
        quantity: item.quantity || item.qty || 1,
        status: item.status || "Planejado"
      }
    })
    .filter(Boolean)
}

function normalizeAttachments(value) {
  const items = Array.isArray(value) ? value : []
  return items
    .map((item, index) => {
      if (!item) return null
      return {
        id: item.id || item.attachment_id || `attachment-${index + 1}`,
        name: item.name || item.filename || item.file_name || `Anexo ${index + 1}`,
        note: item.note || item.description || "",
        url: item.url || item.file_url || item.download_url || "",
        thumbnail_url: item.thumbnail_url || item.preview_url || "",
        preview_url: item.preview_url || "",
        content_type: item.content_type || item.mime_type || guessMimeType(item.name || item.filename || ""),
        created_at: item.created_at || item.uploaded_at || item.date || ""
      }
    })
    .filter(Boolean)
}

function cacheWorkOrder(workOrder) {
  const id = getWorkOrderId(workOrder)
  if (!id) return
  KB.workOrderCache.set(String(id), workOrder)
}

function getWorkOrderId(workOrder) {
  const value = workOrder?.id ?? workOrder?.work_order_id ?? workOrder?.os_id
  return value == null || value === "" ? null : Number(value)
}

function getFilteredTasks(detail) {
  const tasks = Array.isArray(detail?.tasks) ? detail.tasks : []
  if (KB.currentTaskFilter === "open") return tasks.filter((task) => normalizeTaskStatus(task.status) === "nao_iniciada")
  if (KB.currentTaskFilter === "running") return tasks.filter((task) => normalizeTaskStatus(task.status) === "em_andamento")
  if (KB.currentTaskFilter === "done") return tasks.filter((task) => normalizeTaskStatus(task.status) === "concluida")
  return tasks
}

function findTaskById(detail, taskId) {
  return (detail?.tasks || []).find((task) => String(task.id) === String(taskId))
}

function syncPrimaryTaskStatus(detail, status) {
  if (!detail?.tasks?.length) return
  detail.tasks[0].status = normalizeTaskStatus(status)
  detail.progress = getProgressValue(detail)
}

function syncPrimaryTaskToDetail(detail) {
  if (!detail || !Array.isArray(detail.tasks) || !detail.tasks.length) return detail

  const primaryTask = detail.tasks[0]
  detail.task_description = primaryTask.name
  detail.asset_name = primaryTask.asset_name
  detail.asset_code = primaryTask.asset_code
  detail.asset_location = primaryTask.asset_location
  detail.task_type = primaryTask.task_type
  detail.classification_1 = primaryTask.classification_1
  detail.classification_2 = primaryTask.classification_2
  detail.request_number = primaryTask.request_number
  detail.criticality = primaryTask.criticality
  detail.estimated_duration = primaryTask.estimated_duration
  detail.scheduled_date = primaryTask.scheduled_date
  detail.start_date = primaryTask.start_date
  detail.end_date = primaryTask.end_date
  detail.procedure = primaryTask.procedure
  detail.subtasks = primaryTask.subtasks
  detail.resources = primaryTask.resources
  detail.attachments = primaryTask.attachments
  detail.attachmentsLoaded = !!primaryTask.attachmentsLoaded

  const taskStatus = normalizeTaskStatus(primaryTask.status)
  if (taskStatus === "em_andamento" && detail.status === "pendente") detail.status = "em_processo"
  if (taskStatus === "concluida") detail.status = "concluida"

  detail.progress = getProgressValue({
    progress: detail.progress,
    status: detail.status,
    subtasks: primaryTask.subtasks
  })
  return detail
}

function cloneWorkOrderDetail(detail) {
  return normalizeWorkOrderDetail(JSON.parse(JSON.stringify(detail || {})))
}

function buildWorkOrderPatchPayload(detail) {
  const primaryTask = detail.tasks?.[0] || {}

  return {
    asset_id: detail.asset_id || null,
    asset_name: primaryTask.asset_name || detail.asset_name || null,
    asset_code: primaryTask.asset_code || detail.asset_code || null,
    asset_location: primaryTask.asset_location || detail.asset_location || null,
    plant_id: detail.plant_id || null,
    incident_date: detail.incident_date || null,
    requested_by: detail.requested_by || null,
    asset_failed: !!detail.asset_failed,
    failure_type: detail.failure_type || null,
    failure_cause: detail.failure_cause || null,
    failure_detection_method: detail.failure_detection_method || null,
    failure_severity: detail.failure_severity || null,
    damage_type: detail.damage_type || null,
    caused_interruption_duration: detail.caused_interruption_duration || null,
    back_to_service: !!detail.back_to_service,
    task_description: primaryTask.name || detail.task_description || null,
    observations: detail.observations || "",
    task_type: primaryTask.task_type || detail.task_type || null,
    classification_1: primaryTask.classification_1 || detail.classification_1 || null,
    classification_2: primaryTask.classification_2 || detail.classification_2 || null,
    criticality: primaryTask.criticality || detail.criticality || "media",
    estimated_duration: primaryTask.estimated_duration || detail.estimated_duration || null,
    request_number: primaryTask.request_number || detail.request_number || null,
    responsavel_id: detail.responsavel_id || detail.assignee_id || null,
    responsavel_name: detail.responsavel_name || null,
    responsavel_email: detail.responsavel_email || null,
    status: detail.status || "pendente",
    scheduled_date: detail.scheduled_date || null,
    start_date: detail.start_date || null,
    end_date: detail.end_date || null,
    subtasks: serializeSubtasks(primaryTask.subtasks || detail.subtasks),
    resources: serializeResources(primaryTask.resources || detail.resources),
    tasks: serializeTasks(detail.tasks || [])
  }
}

function serializeTasks(tasks) {
  return (tasks || []).map((task) => ({
    id: task.id,
    asset_name: task.asset_name || null,
    asset_code: task.asset_code || null,
    asset_location: task.asset_location || null,
    name: task.name || null,
    task_description: task.name || null,
    task_type: task.task_type || null,
    criticality: task.criticality || null,
    classification_1: task.classification_1 || null,
    classification_2: task.classification_2 || null,
    request_number: task.request_number || null,
    estimated_duration: task.estimated_duration || null,
    scheduled_date: task.scheduled_date || null,
    start_date: task.start_date || null,
    end_date: task.end_date || null,
    procedure: task.procedure || "",
    status: normalizeTaskStatus(task.status),
    subtasks: serializeSubtasks(task.subtasks),
    resources: serializeResources(task.resources),
    execution_logs: Array.isArray(task.execution_logs) ? task.execution_logs : []
  }))
}

function serializeSubtasks(subtasks) {
  return (subtasks || []).map((item) => ({ id: item.id, title: item.title, done: !!item.done }))
}

function serializeResources(resources) {
  return (resources || []).map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity || 1,
    status: item.status || "Planejado"
  }))
}

function getProgressValue(source) {
  const raw = toNumber(source?.progress)
  if (raw != null) return clamp(Math.round(raw), 0, 100)

  const subtasks = Array.isArray(source?.subtasks) ? source.subtasks : []
  if (subtasks.length) {
    const completed = subtasks.filter((item) => item.done).length
    return clamp(Math.round((completed / subtasks.length) * 100), 0, 100)
  }

  const status = normalizeTaskStatus(source?.status)
  if (status === "concluida") return 100
  if (status === "em_verificacao") return 80
  if (status === "em_andamento") return 45
  return 0
}

function normalizeTaskStatus(status) {
  const value = safeLower(status)
  if (value === "em_processo" || value === "em processo" || value === "em andamento" || value === "em_andamento") return "em_andamento"
  if (value === "em_verificacao" || value === "em verificacao") return "em_verificacao"
  if (value === "concluida" || value === "concluido") return "concluida"
  if (value === "cancelada" || value === "cancelado") return "cancelada"
  if (value === "nao iniciada" || value === "nao_iniciada" || value === "pendente") return "nao_iniciada"
  return "nao_iniciada"
}

function getStatusColor(status) {
  if (status === "pendente") return "#f59e0b"
  if (status === "em_processo") return "#3b82f6"
  if (status === "em_verificacao") return "#a855f7"
  if (status === "concluida") return "#2aff7b"
  if (status === "cancelada") return "#ef4444"
  return "transparent"
}

function isOverdue(workOrder) {
  if (!workOrder?.scheduled_date || workOrder?.status === "concluida" || workOrder?.status === "cancelada") return false
  const target = new Date(workOrder.scheduled_date)
  if (Number.isNaN(target.getTime())) return false
  return target.getTime() < Date.now()
}

function computeExecutionTime(task) {
  if (!task) return "---"

  if (task.start_date && task.end_date) {
    const start = new Date(task.start_date)
    const end = new Date(task.end_date)
    const diffMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
    return minutesToHourLabel(diffMinutes)
  }

  const totalLoggedMinutes = (task.execution_logs || []).reduce(
    (total, item) => total + durationToMinutes(item.duration),
    0
  )
  return totalLoggedMinutes > 0 ? minutesToHourLabel(totalLoggedMinutes) : "---"
}

function formatDurationCompact(value) {
  const minutes = durationToMinutes(value)
  if (!minutes && minutes !== 0) return "00:10"
  return minutesToHourLabel(minutes, false)
}

function formatDurationLong(value) {
  const minutes = durationToMinutes(value)
  if (!minutes && minutes !== 0) return "00:10:00"
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`
}

function durationToMinutes(value) {
  if (value == null || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) return value

  const raw = String(value).trim()
  if (!raw) return null
  const parts = raw.split(":").map((part) => Number(part))
  if (parts.some((part) => Number.isNaN(part))) return null

  if (parts.length === 2) {
    const [hours, minutes] = parts
    return hours * 60 + minutes
  }

  if (parts.length >= 3) {
    const [hours, minutes, seconds] = parts
    return hours * 60 + minutes + Math.round((seconds || 0) / 60)
  }

  return null
}

function minutesToHourLabel(minutes) {
  const safeMinutes = Math.max(0, Number(minutes) || 0)
  const hours = Math.floor(safeMinutes / 60)
  const mins = safeMinutes % 60
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`
}

function formatCriticality(value) {
  const normalized = safeLower(value)
  if (normalized === "muito alta" || normalized === "muito_alta" || normalized === "muito alto" || normalized === "critica" || normalized === "critico") {
    return { key: "muito_alta", label: "Muito alto" }
  }
  if (normalized === "alta") return { key: "alta", label: "Alto" }
  if (normalized === "baixa") return { key: "baixa", label: "Baixo" }
  return { key: "media", label: "M\u00e9dio" }
}

function resolveUserWeekHoursValue(user, dayColumn) {
  const sources = [
    user?.week_hours,
    user?.weekHours,
    user?.hours_by_day,
    user?.hoursByDay,
    user?.availability,
    user?.schedule,
    user?.working_hours,
    user?.workingHours
  ].filter(Boolean)

  for (const source of sources) {
    const resolved = resolveWeekHoursFromSource(source, dayColumn.aliases)
    if (resolved != null) return resolved
  }

  return null
}

function resolveWeekHoursFromSource(source, aliases) {
  if (Array.isArray(source)) {
    for (const item of source) {
      const dayKey = safeLower(
        item?.day || item?.weekday || item?.week_day || item?.label || item?.name || item?.title || item?.key
      )
      if (!aliases.includes(dayKey)) continue
      return normalizeWeekHoursValue(
        item?.hours ?? item?.value ?? item?.duration ?? item?.total ?? item?.label_value ?? item?.time ?? null
      )
    }
    return null
  }

  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (!aliases.includes(safeLower(key))) continue
      return normalizeWeekHoursValue(value)
    }
  }

  return null
}

function normalizeWeekHoursValue(value) {
  if (value == null) return null

  if (Array.isArray(value)) {
    const joined = value.map((item) => normalizeWeekHoursValue(item)).filter(Boolean).join(" | ")
    return joined || null
  }

  if (typeof value === "object") {
    return normalizeWeekHoursValue(value.hours ?? value.value ?? value.duration ?? value.total ?? value.label ?? value.time ?? null)
  }

  const text = String(value).trim()
  return text || null
}

function hasHoursBadgeValue(value) {
  const normalized = safeLower(value)
  if (!normalized) return false
  return !["0", "0h", "00:00", "00:00:00", "sem horas", "sem hora", "null", "-", "---"].includes(normalized)
}

function fmtDate(value) {
  if (!value) return "---"
  try {
    return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })
  } catch (_error) {
    return "---"
  }
}

function fmtDateLong(value) {
  if (!value) return "---"
  try {
    return new Date(value).toLocaleDateString("pt-BR", { year: "numeric", month: "2-digit", day: "2-digit" })
  } catch (_error) {
    return "---"
  }
}

function fmtDatetime(value) {
  if (!value) return "---"
  try {
    return new Date(value).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  } catch (_error) {
    return "---"
  }
}

function toDatetimeLocalInputValue(value) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16)
  const tzOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16)
}

function readDatetimeLocalValue(id) {
  const value = document.getElementById(id)?.value || ""
  return value || null
}

function formatCurrencyBRL(value) {
  const amount = toNumber(value) || 0
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount)
}

function avatarInitials(name) {
  return (name || "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function formatBytes(value) {
  const size = Number(value) || 0
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${Math.round(size / 1024)} KB`
  return `${size} B`
}

function toNumber(value) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getBoardSearch() {
  return document.getElementById("kbSearchInput")?.value?.trim() || ""
}

function safeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function pickArray(value) {
  return Array.isArray(value) && value.length ? value : null
}

function isImageAttachment(attachment) {
  const contentType = String(attachment?.content_type || "").toLowerCase()
  const name = String(attachment?.name || "").toLowerCase()
  return contentType.startsWith("image/") || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(name)
}

function guessMimeType(name) {
  const lower = String(name || "").toLowerCase()
  if (/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(lower)) return "image/*"
  if (/\.pdf$/.test(lower)) return "application/pdf"
  return "application/octet-stream"
}

function esc(value) {
  if (value == null) return ""
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function escAttr(value) {
  return esc(value).replace(/'/g, "&#39;")
}

let toastTimer = null
function showToast(message, type = "success") {
  const toast = document.getElementById("osToast")
  const icon = document.getElementById("osToastIcon")
  const text = document.getElementById("osToastText")
  if (!toast || !icon || !text) return

  const iconByType = {
    success: "fa-solid fa-circle-check",
    error: "fa-solid fa-circle-xmark",
    info: "fa-solid fa-circle-info"
  }

  icon.innerHTML = `<i class="${iconByType[type] || iconByType.success}"></i>`
  text.textContent = message
  toast.className = `os-toast os-toast--${type}`

  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500)
}
