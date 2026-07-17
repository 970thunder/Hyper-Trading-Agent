import { authHeaders, withAuthQuery } from "@/lib/apiAuth";

const BASE = "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const AUTH_REQUIRED_MESSAGE =
  "Remote API access requires an API key. Add it in Settings, or run the backend on localhost for local-only use.";
export const LOGIN_REQUIRED_MESSAGE = "Please sign in to access this organization workspace.";
export const PERMISSION_REQUIRED_MESSAGE = "Your account does not have permission to perform this action.";

export function isAuthRequiredError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    detail = body.detail || body.message || detail;
  } catch { /* ignore */ }
  if (res.status === 401) {
    detail = detail.toLowerCase().includes("api key") ? AUTH_REQUIRED_MESSAGE : LOGIN_REQUIRED_MESSAGE;
  }
  if (res.status === 403) {
    detail = detail.toLowerCase().includes("api_auth_key") || detail.toLowerCase().includes("api key")
      ? AUTH_REQUIRED_MESSAGE
      : PERMISSION_REQUIRED_MESSAGE;
  }
  return new ApiError(detail, res.status);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers, ...rest } = options ?? {};
  const mergedHeaders: Record<string, string> = { "Content-Type": "application/json", ...authHeaders() };
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      mergedHeaders[key] = value;
    });
  }
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: mergedHeaders,
    credentials: "include",
  });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  const text = await res.text();
  if (!text) return {} as T;

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const preview = text.slice(0, 80).replace(/\s+/g, " ");
    throw new ApiError(
      `Expected JSON from ${path}, got ${contentType || "unknown content type"}: ${preview}`,
      res.status,
    );
  }

  return JSON.parse(text) as T;
}

export interface UploadResult {
  status: string;
  file_path: string;
  filename: string;
}

async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", headers: authHeaders(), body: form, credentials: "include" });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  return res.json();
}

function appendQueryParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export const api = {
  uploadFile,
  listRuns: (limit?: number) => request<RunListItem[]>(`/runs${limit ? `?limit=${encodeURIComponent(String(limit))}` : ""}`),
  getRun: (id: string, params: RunDetailParams = {}) => {
    const q = new URLSearchParams();
    if (params.chart_payload) q.set("chart_payload", params.chart_payload);
    if (params.chart_symbol) q.set("chart_symbol", params.chart_symbol);
    const qs = q.toString();
    return request<RunData>(`/runs/${id}${qs ? `?${qs}` : ""}`);
  },
  getRunCode: (id: string) => request<Record<string, string>>(`/runs/${id}/code`),
  getRunPine: (id: string) => request<PineScriptResult>(`/runs/${id}/pine`),
  listSessions: (limit?: number) => request<SessionItem[]>(`/sessions${limit ? `?limit=${encodeURIComponent(String(limit))}` : ""}`),
  createSession: (title?: string, config?: Record<string, unknown>) =>
    request<SessionItem>("/sessions", { method: "POST", body: JSON.stringify({ title: title || "", config }) }),
  deleteSession: (sid: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "DELETE" }),
  renameSession: (sid: string, title: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  sendMessage: (sid: string, content: string, options?: { model_provider_id?: string; execution_mode?: ExecutionMode }) =>
    request<{ message_id: string; attempt_id: string; execution_mode: ExecutionMode }>(`/sessions/${sid}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, model_provider_id: options?.model_provider_id || undefined, execution_mode: options?.execution_mode || "auto" }),
    }),
  cancelSession: (sid: string) => request<{ status: string; attempt_id?: string }>(`/sessions/${sid}/cancel`, { method: "POST" }),
  getAttemptExecution: (sid: string, attemptId: string) =>
    request<AttemptExecution>(`/sessions/${sid}/attempts/${attemptId}/execution`),
  pauseAttempt: (sid: string, attemptId: string) =>
    request<{ attempt_id: string; status: string }>(`/sessions/${sid}/attempts/${attemptId}/pause`, { method: "POST" }),
  resumeAttempt: (sid: string, attemptId: string) =>
    request<{ attempt_id: string; status: string }>(`/sessions/${sid}/attempts/${attemptId}/resume`, { method: "POST" }),
  searchSessionHistory: (query: string, options?: { limit?: number; current_session_id?: string }) => {
    const q = new URLSearchParams({ q: query });
    if (options?.limit) q.set("limit", String(options.limit));
    if (options?.current_session_id) q.set("current_session_id", options.current_session_id);
    return request<SessionHistorySearchResponse>(`/session-history/search?${q.toString()}`);
  },
  listApprovals: (status = "pending") => request<ApprovalRecord[]>(`/approvals?status=${encodeURIComponent(status)}`),
  approveToolCall: (approvalId: string, note = "") =>
    request<{ approval: ApprovalRecord; attempt_status: string }>(`/approvals/${approvalId}/approve`, { method: "POST", body: JSON.stringify({ note }) }),
  rejectToolCall: (approvalId: string, note = "") =>
    request<{ approval: ApprovalRecord; attempt_status: string }>(`/approvals/${approvalId}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
  getSessionMessages: (sid: string) => request<MessageItem[]>(`/sessions/${sid}/messages`),
  createGoal: (sid: string, body: CreateGoalRequest) =>
    request<GoalSnapshot>(`/sessions/${sid}/goal`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getGoal: (sid: string) => request<GoalSnapshot | null>(`/sessions/${sid}/goal`),
  updateGoal: (sid: string, body: UpdateGoalRequest) =>
    request<UpdateGoalResponse>(`/sessions/${sid}/goal`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  addGoalEvidence: (sid: string, body: AddGoalEvidenceRequest) =>
    request<AddGoalEvidenceResponse>(`/sessions/${sid}/goal/evidence`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateGoalStatus: (sid: string, body: UpdateGoalStatusRequest) =>
    request<UpdateGoalStatusResponse>(`/sessions/${sid}/goal/status`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  sseUrl: (sid: string, options?: { replay?: "active" }) => {
    let url = withAuthQuery(`${BASE}/sessions/${sid}/events`);
    if (options?.replay) url = appendQueryParam(url, "replay", options.replay);
    return url;
  },

  // Swarm API
  listSwarmPresets: () => request<SwarmPreset[]>("/swarm/presets"),
  listSwarmPresetAgents: (presetName: string) =>
    request<SwarmPresetAgentList>(`/swarm/presets/${encodeURIComponent(presetName)}/agents`),
  createSwarmPresetAgent: (presetName: string, body: SwarmPresetAgentRequest) =>
    request<SwarmPresetAgent>(`/swarm/presets/${encodeURIComponent(presetName)}/agents`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSwarmPresetAgent: (presetName: string, agentId: string, body: SwarmPresetAgentRequest) =>
    request<SwarmPresetAgent>(`/swarm/presets/${encodeURIComponent(presetName)}/agents/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteSwarmPresetAgent: (presetName: string, agentId: string) =>
    request<{ agent_id: string; removed_task_ids: string[] }>(`/swarm/presets/${encodeURIComponent(presetName)}/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    }),
  createSwarmRun: (preset_name: string, user_vars: Record<string, string>) =>
    request<{ id: string; status: string }>("/swarm/runs", {
      method: "POST",
      body: JSON.stringify({ preset_name, user_vars }),
    }),
  listSwarmRuns: () => request<SwarmRunSummary[]>("/swarm/runs"),
  getSwarmRun: (id: string) => request<Record<string, unknown>>(`/swarm/runs/${id}`),
  swarmSseUrl: (id: string) => withAuthQuery(`${BASE}/swarm/runs/${id}/events`),
  cancelSwarmRun: (id: string) =>
    request<{ status: string }>(`/swarm/runs/${id}/cancel`, { method: "POST" }),
  retrySwarmRun: (id: string) =>
    request<{ id: string; status: string; preset_name: string }>(`/swarm/runs/${id}/retry`, { method: "POST" }),
  getLLMSettings: () => request<LLMSettings>("/settings/llm"),
  updateLLMSettings: (settings: UpdateLLMSettingsRequest) =>
    request<LLMSettings>("/settings/llm", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  getDataSourceSettings: () => request<DataSourceSettings>("/settings/data-sources"),
  updateDataSourceSettings: (settings: UpdateDataSourceSettingsRequest) =>
    request<DataSourceSettings>("/settings/data-sources", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  listMarketDataSources: () => request<MarketDataSourcesResponse>("/market-data/sources"),
  searchMarketSymbols: (query: string, limit = 8) => request<MarketSymbolSearchResponse>(`/market-data/symbol-search?q=${encodeURIComponent(query)}&limit=${limit}`),
  listPortfolioProfiles: () => request<PortfolioProfilesResponse>("/portfolio/profiles"),
  getPortfolioSnapshot: (profileId?: string) => request<PortfolioSnapshot>(`/portfolio/snapshot${profileId ? `?profile_id=${encodeURIComponent(profileId)}` : ""}`),
  getMarketDataHistory: (params: MarketDataHistoryQuery) => {
    const query = new URLSearchParams({
      symbols: params.symbols.join(","),
      start: params.start,
      end: params.end,
      source: params.source || "auto",
      interval: params.interval || "1D",
    });
    if (params.max_rows) query.set("max_rows", String(params.max_rows));
    return request<MarketDataHistoryResponse>(`/market-data/history?${query.toString()}`);
  },
  getKnowledgeStats: () => request<KnowledgeStats>("/knowledge/stats"),
  listKnowledgeDocuments: () => request<KnowledgeDocument[]>("/knowledge/documents"),
  addKnowledgeDocument: (body: AddKnowledgeDocumentRequest) =>
    request<KnowledgeDocument>("/knowledge/documents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  searchKnowledge: (body: KnowledgeSearchRequest) =>
    request<KnowledgeSearchResponse>("/knowledge/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  registerCommercialOwner: (body: CommercialRegisterRequest) =>
    request<CommercialPrincipal>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  loginCommercial: (body: CommercialLoginRequest) =>
    request<CommercialPrincipal>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logoutCommercial: () => request<{ status: string }>("/auth/logout", { method: "POST" }),
  getAuthStatus: () => request<CommercialAuthStatus>("/auth/status"),
  getCommercialMe: () => request<CommercialPrincipal>("/auth/me"),
  getCurrentOrganization: () => request<CommercialOrganization>("/organizations/current"),
  listCommercialModelCatalog: () => request<LLMProviderOption[]>("/models/catalog"),
  listAvailableOrganizations: () => request<CommercialOrganizationMembership[]>("/organizations"),
  switchOrganization: (organizationId: string) =>
    request<CommercialPrincipal>("/organizations/switch", {
      method: "POST",
      body: JSON.stringify({ organization_id: organizationId }),
    }),
  listOrganizationMembers: () => request<CommercialOrganizationMember[]>("/organizations/current/members"),
  createOrganizationMember: (body: CommercialOrganizationMemberCreateRequest) =>
    request<CommercialOrganizationMember>("/organizations/current/members", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateOrganizationMember: (userId: string, body: CommercialOrganizationMemberUpdateRequest) =>
    request<CommercialOrganizationMember>(`/organizations/current/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteOrganizationMember: (userId: string) =>
    request<{ status: string; user_id: string }>(`/organizations/current/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  listCommercialModelProviders: () => request<CommercialModelProvider[]>("/models/providers"),
  createCommercialModelProvider: (body: CommercialModelProviderCreateRequest) =>
    request<CommercialModelProvider>("/models/providers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCommercialModelProvider: (id: string, body: CommercialModelProviderUpdateRequest) =>
    request<CommercialModelProvider>(`/models/providers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  setDefaultCommercialModelProvider: (id: string) =>
    request<CommercialModelProvider>(`/models/providers/${encodeURIComponent(id)}/default`, {
      method: "POST",
    }),
  deleteCommercialModelProvider: (id: string) =>
    request<{ status: string; provider_id: string }>(`/models/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  testCommercialModelProvider: (id: string) =>
    request<CommercialModelProviderTestResult>(`/models/providers/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }),
  listKnowledgeBases: () => request<CommercialKnowledgeBase[]>("/knowledge-bases"),
  getCommercialKnowledgeBackendStatus: () => request<CommercialKnowledgeBackendStatus>("/knowledge-bases/status"),
  createKnowledgeBase: (body: CommercialKnowledgeBaseCreateRequest) =>
    request<CommercialKnowledgeBase>("/knowledge-bases", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateKnowledgeBase: (knowledgeBaseId: string, body: CommercialKnowledgeBaseUpdateRequest) =>
    request<CommercialKnowledgeBase>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listCommercialKnowledgeDocuments: (knowledgeBaseId: string) =>
    request<CommercialKnowledgeDocument[]>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`),
  getCommercialKnowledgeDocumentDetail: (knowledgeBaseId: string, documentId: string) =>
    request<CommercialKnowledgeDocumentDetail>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`,
    ),
  listCommercialKnowledgeDocumentChunks: (knowledgeBaseId: string, documentId: string) =>
    request<CommercialKnowledgeChunkList>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/chunks`,
    ),
  addCommercialKnowledgeDocument: (knowledgeBaseId: string, body: CommercialKnowledgeDocumentCreateRequest) =>
    request<CommercialKnowledgeDocument | CommercialIngestionJob>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addCommercialKnowledgeUrl: (knowledgeBaseId: string, body: CommercialKnowledgeUrlCreateRequest) =>
    request<CommercialKnowledgeDocument | CommercialIngestionJob>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/urls`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteCommercialKnowledgeDocument: (knowledgeBaseId: string, documentId: string) =>
    request<{ status: string }>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    ),
  searchCommercialKnowledge: (knowledgeBaseId: string, body: CommercialKnowledgeSearchRequest) =>
    request<CommercialKnowledgeSearchResponse>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/search`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listCommercialKnowledgeEvaluationDatasets: (knowledgeBaseId: string) =>
    request<CommercialKnowledgeEvaluationDataset[]>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets`),
  createCommercialKnowledgeEvaluationDataset: (knowledgeBaseId: string, body: CommercialKnowledgeEvaluationDatasetCreateRequest) =>
    request<CommercialKnowledgeEvaluationDataset>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCommercialKnowledgeEvaluationDataset: (knowledgeBaseId: string, datasetId: string, body: CommercialKnowledgeEvaluationDatasetUpdateRequest) =>
    request<CommercialKnowledgeEvaluationDataset>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets/${encodeURIComponent(datasetId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  deleteCommercialKnowledgeEvaluationDataset: (knowledgeBaseId: string, datasetId: string) =>
    request<{ status: string }>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets/${encodeURIComponent(datasetId)}`,
      { method: "DELETE" },
    ),
  listCommercialKnowledgeEvaluationCases: (knowledgeBaseId: string, datasetId: string) =>
    request<CommercialKnowledgeEvaluationCase[]>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets/${encodeURIComponent(datasetId)}/cases`,
    ),
  createCommercialKnowledgeEvaluationCase: (knowledgeBaseId: string, datasetId: string, body: CommercialKnowledgeEvaluationCaseCreateRequest) =>
    request<CommercialKnowledgeEvaluationCase>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets/${encodeURIComponent(datasetId)}/cases`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  deleteCommercialKnowledgeEvaluationCase: (knowledgeBaseId: string, datasetId: string, caseId: string) =>
    request<{ status: string }>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
      { method: "DELETE" },
    ),
  runCommercialKnowledgeEvaluationDataset: (knowledgeBaseId: string, datasetId: string, body: CommercialKnowledgeEvaluationRunRequest = {}) =>
    request<CommercialKnowledgeEvaluationRun>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets/${encodeURIComponent(datasetId)}/runs`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  listCommercialKnowledgeEvaluationRuns: (knowledgeBaseId: string, datasetId: string, limit?: number) =>
    request<CommercialKnowledgeEvaluationRun[]>(
      `/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/evaluation-datasets/${encodeURIComponent(datasetId)}/runs${limit ? `?limit=${encodeURIComponent(String(limit))}` : ""}`,
    ),
  getCommercialIngestionJob: (knowledgeBaseId: string, jobId: string) =>
    request<CommercialIngestionJob>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/ingestion-jobs/${encodeURIComponent(jobId)}`),
  listCommercialIngestionJobs: (knowledgeBaseId: string, limit?: number) =>
    request<CommercialIngestionJob[]>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/ingestion-jobs${limit ? `?limit=${encodeURIComponent(String(limit))}` : ""}`),
  retryCommercialIngestionJob: (knowledgeBaseId: string, jobId: string) =>
    request<CommercialKnowledgeDocument | CommercialIngestionJob>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/ingestion-jobs/${encodeURIComponent(jobId)}/retry`, {
      method: "POST",
    }),
  cancelCommercialIngestionJob: (knowledgeBaseId: string, jobId: string) =>
    request<CommercialIngestionJob>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/ingestion-jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
    }),
  reindexCommercialKnowledgeDocument: (knowledgeBaseId: string, documentId: string) =>
    request<CommercialKnowledgeDocument>(`/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}/reindex`, {
      method: "POST",
    }),
  listToolPolicies: () => request<ToolPolicy[]>("/tools/policies"),
  updateToolPolicy: (toolName: string, body: ToolPolicyUpdateRequest) =>
    request<ToolPolicy>(`/tools/policies/${encodeURIComponent(toolName)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listAuditLogs: (limit?: number, filters?: AuditLogFilters) => {
    const q = new URLSearchParams();
    if (limit) q.set("limit", String(limit));
    if (filters?.type) q.set("type", filters.type);
    if (filters?.actor) q.set("actor", filters.actor);
    if (filters?.resource) q.set("resource", filters.resource);
    if (filters?.from) q.set("from", filters.from);
    if (filters?.to) q.set("to", filters.to);
    const qs = q.toString();
    return request<AuditLog[]>(`/audit-logs${qs ? `?${qs}` : ""}`);
  },
  getAdminConversationAudit: (limit = 200) =>
    request<AdminConversationAuditResponse>(`/admin/audit/conversations?limit=${encodeURIComponent(String(limit))}`),
  listModelUsage: (limit?: number) => request<ModelUsage[]>(`/usage/model-calls${limit ? `?limit=${encodeURIComponent(String(limit))}` : ""}`),
  getUsageSummary: () => request<OrganizationUsageSummary>("/usage/summary"),
  getUsageTimeseries: (days = 30) => request<UsageTimeseriesResponse>(`/usage/timeseries?days=${encodeURIComponent(String(days))}`),
  listUsageAlerts: (options?: { limit?: number; includeAcknowledged?: boolean }) => {
    const q = new URLSearchParams();
    if (options?.limit) q.set("limit", String(options.limit));
    if (options?.includeAcknowledged) q.set("include_acknowledged", "true");
    const query = q.toString();
    return request<UsageAlertEvent[]>(`/usage/alerts${query ? `?${query}` : ""}`);
  },
  acknowledgeUsageAlert: (alertId: string) =>
    request<UsageAlertEvent>(`/usage/alerts/${encodeURIComponent(alertId)}/acknowledge`, { method: "POST" }),
  getUsagePolicy: () => request<OrganizationUsagePolicy>("/usage/policy"),
  updateUsagePolicy: (body: OrganizationUsagePolicyUpdateRequest) =>
    request<OrganizationUsagePolicy>("/usage/policy", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  createFeedback: (body: FeedbackCreateRequest) =>
    request<FeedbackEvent>("/feedback", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listFeedback: (params: FeedbackListParams = {}) => {
    const q = new URLSearchParams();
    if (params.limit) q.set("limit", String(params.limit));
    if (params.target_type) q.set("target_type", params.target_type);
    if (params.target_id) q.set("target_id", params.target_id);
    const qs = q.toString();
    return request<FeedbackEvent[]>(`/feedback${qs ? `?${qs}` : ""}`);
  },
  listPersistentMemory: (params: { query?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.query) query.set("query", params.query);
    if (params.limit) query.set("limit", String(params.limit));
    const suffix = query.toString();
    return request<PersistentMemoryRecord[]>(`/memory${suffix ? `?${suffix}` : ""}`);
  },
  getPersistentMemory: (memoryId: string) =>
    request<PersistentMemoryRecord>(`/memory/${encodeURIComponent(memoryId)}`),
  createPersistentMemory: (body: PersistentMemoryCreateRequest) =>
    request<PersistentMemoryRecord>("/memory", { method: "POST", body: JSON.stringify(body) }),
  deletePersistentMemory: (memoryId: string) =>
    request<{ status: string; memory_id: string }>(`/memory/${encodeURIComponent(memoryId)}`, { method: "DELETE" }),
  purgePersistentMemory: (olderThanDays: number) =>
    request<{ status: string; removed_count: number; older_than_days: number }>("/memory/purge", {
      method: "POST",
      body: JSON.stringify({ older_than_days: olderThanDays }),
    }),
  getPlatformSummary: () => request<PlatformSummary>("/platform-admin/summary"),
  getPlatformOperations: () => request<PlatformOperations>("/platform-admin/operations"),
  runPlatformMaintenance: (action: PlatformMaintenanceAction) =>
    request<PlatformMaintenanceResult>("/platform-admin/maintenance", {
      method: "POST",
      body: JSON.stringify({ action, confirmed: true }),
    }),
  listPlatformRuntimeJobs: () => request<PlatformRuntimeJob[]>("/platform-admin/runtime-jobs"),
  listPlatformWorkspaceArtifacts: (params: { artifact_type?: string; organization_id?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.artifact_type) query.set("artifact_type", params.artifact_type);
    if (params.organization_id) query.set("organization_id", params.organization_id);
    const suffix = query.toString();
    return request<PlatformWorkspaceArtifact[]>(`/platform-admin/workspace-artifacts${suffix ? `?${suffix}` : ""}`);
  },
  listPlatformUsers: (query = "") =>
    request<PlatformUser[]>(`/platform-admin/users${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  updatePlatformUser: (userId: string, body: PlatformUserUpdateRequest) =>
    request<PlatformUser>(`/platform-admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  grantPlatformAdmin: (userId: string) =>
    request<PlatformUser>(`/platform-admin/users/${encodeURIComponent(userId)}/platform-admin`, { method: "POST" }),
  revokePlatformAdmin: (userId: string) =>
    request<PlatformUser>(`/platform-admin/users/${encodeURIComponent(userId)}/platform-admin`, { method: "DELETE" }),
  listPlatformOrganizations: (query = "") =>
    request<PlatformOrganization[]>(`/platform-admin/organizations${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  listPlatformUsage: () => request<PlatformUsageSummary[]>("/platform-admin/usage"),
  getPlatformUsageTimeseries: (days = 30) => request<UsageTimeseriesResponse>(`/platform-admin/usage/timeseries?days=${encodeURIComponent(String(days))}`),
  updatePlatformOrganization: (organizationId: string, body: PlatformOrganizationUpdateRequest) =>
    request<PlatformOrganization>(`/platform-admin/organizations/${encodeURIComponent(organizationId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listPlatformKnowledgeBases: (query = "") =>
    request<PlatformKnowledgeBase[]>(`/platform-admin/knowledge-bases${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  deletePlatformKnowledgeBase: (knowledgeBaseId: string) =>
    request<{ status: string; knowledge_base_id: string }>(`/platform-admin/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}`, { method: "DELETE" }),
  listPlatformIngestionJobs: (status?: string) =>
    request<PlatformIngestionJob[]>(`/platform-admin/ingestion-jobs${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  retryPlatformIngestionJob: (jobId: string) =>
    request<PlatformIngestionJob>(`/platform-admin/ingestion-jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }),
  cancelPlatformIngestionJob: (jobId: string) =>
    request<PlatformIngestionJob>(`/platform-admin/ingestion-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  listPlatformAuditLogs: (query = "") =>
    request<PlatformAuditLog[]>(`/platform-admin/audit-logs${query ? `?query=${encodeURIComponent(query)}` : ""}`),
  getChannelStatus: () => request<ChannelRuntimeStatus>("/channels/status"),
  startChannels: () => request<ChannelRuntimeActionResponse>("/channels/start", { method: "POST" }),
  stopChannels: () => request<ChannelRuntimeActionResponse>("/channels/stop", { method: "POST" }),
  runChannelPairingCommand: (body: ChannelPairingCommandRequest) =>
    request<ChannelPairingCommandResponse>("/channels/pairing/command", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Alpha Zoo API
  listAlphas: (params: AlphaListParams = {}) => {
    const q = new URLSearchParams();
    if (params.zoo) q.set("zoo", params.zoo);
    if (params.theme) q.set("theme", params.theme);
    if (params.universe) q.set("universe", params.universe);
    if (params.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<AlphaListResponse>(`/alpha/list${qs ? `?${qs}` : ""}`);
  },
  getAlpha: (alphaId: string) =>
    request<AlphaDetailResponse>(`/alpha/${encodeURIComponent(alphaId)}`),
  createAlphaBench: (body: AlphaBenchRequest) =>
    request<{ status: string; job_id: string }>("/alpha/bench", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alphaBenchStreamUrl: (jobId: string) =>
    withAuthQuery(`${BASE}/alpha/bench/${encodeURIComponent(jobId)}/stream`),
  createAlphaCompare: (body: AlphaCompareRequest) =>
    request<{ status: string; job_id: string }>("/alpha/compare", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  alphaCompareStreamUrl: (jobId: string) =>
    withAuthQuery(`${BASE}/alpha/compare/${encodeURIComponent(jobId)}/stream`),

  // Connector runtime channel — privileged surface actions (NOT agent tools).
  // commit is the ONLY action that writes a mandate; halt trips the kill switch.
  commitMandate: (body: CommitMandateRequest) =>
    request<CommitMandateResponse>("/mandate/commit", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  haltLive: (session_id?: string, broker?: string, reason?: string) =>
    request<HaltLiveResponse>("/live/halt", {
      method: "POST",
      body: JSON.stringify({ session_id, broker, reason }),
    }),
  // Read the persistent runtime status across all authorized brokers (SPEC §7.5).
  // Polled by the RunnerStatus panel; a plain authenticated GET, never a chat message.
  getLiveStatus: (signal?: AbortSignal) => request<LiveStatus>("/live/status", { signal }),
  listRuntimeJobs: () => request<RuntimeJob[]>("/runtime/jobs"),
  retryRuntimeJob: (jobId: string) =>
    request<RuntimeJobActionResponse>(`/runtime/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }),
  cancelRuntimeJob: (jobId: string) =>
    request<RuntimeJobActionResponse>(`/runtime/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
  authorizeLive: (broker: string) =>
    request<LiveAuthorizeResponse>("/live/authorize", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }),
  // Start/stop the persistent runner (SPEC §7.5). Privileged surface actions, not agent tools.
  startLiveRunner: (broker: string) =>
    request<LiveRunnerResponse>("/live/runner/start", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }),
  stopLiveRunner: (broker: string) =>
    request<LiveRunnerResponse>("/live/runner/stop", {
      method: "POST",
      body: JSON.stringify({ broker }),
    }),
};

// --- Swarm types ---

export interface SwarmPreset {
  name: string;
  title: string;
  description: string;
  agent_count: number;
  variables: { name: string; description: string; required: boolean }[];
}

export interface SwarmRunSummary {
  id: string;
  preset_name: string;
  status: string;
  created_at: string;
  task_count: number;
  completed_count: number;
}

export interface LLMProviderOption {
  name: string;
  label: string;
  api_key_env?: string | null;
  base_url_env: string;
  default_model: string;
  default_base_url: string;
  model_options?: string[];
  api_key_required: boolean;
  auth_type?: string;
  login_command?: string | null;
}

export interface LLMSettings {
  provider: string;
  model_name: string;
  base_url: string;
  api_key_env?: string | null;
  api_key_configured: boolean;
  api_key_hint?: string | null;
  api_key_required: boolean;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort: string;
  sse_timeout_seconds: number;
  env_path: string;
  providers: LLMProviderOption[];
}

export interface UpdateLLMSettingsRequest {
  provider: string;
  model_name: string;
  base_url: string;
  api_key?: string;
  clear_api_key?: boolean;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort?: string;
}

export interface DataSourceSettings {
  tushare_token_configured: boolean;
  tushare_token_hint?: string | null;
  baostock_supported: boolean;
  baostock_installed: boolean;
  baostock_message: string;
  env_path: string;
}

export interface UpdateDataSourceSettingsRequest {
  tushare_token?: string;
  clear_tushare_token?: boolean;
}

export interface MarketDataHistoryQuery {
  symbols: string[];
  start: string;
  end: string;
  source?: string;
  interval?: string;
  max_rows?: number;
}

export interface MarketDataBar {
  trade_date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
}

export interface MarketDataQuality {
  requested_start: string;
  requested_end: string;
  first_bar: string | null;
  last_bar: string | null;
  source_bars: number;
  returned_bars: number;
  truncated: boolean;
  max_gap_days: number;
  status: "complete" | "partial";
}

export interface MarketDataSeries {
  symbol: string;
  requested_source: string;
  source: string;
  interval: string;
  cache_hit: boolean;
  bars: MarketDataBar[];
  quality: MarketDataQuality;
}

export interface MarketDataHistoryResponse {
  query: MarketDataHistoryQuery;
  series: MarketDataSeries[];
  unresolved: string[];
  generated_at: string;
  cache: MarketDataCache;
  query_cache?: MarketDataQueryCache;
}

export interface MarketDataQueryCache {
  status: "hit" | "miss";
  saved_at: string;
  ttl_seconds: number | null;
  origin?: "query" | "prewarm";
}

export interface MarketDataSource {
  id: string;
  label: string;
  available: boolean;
  requires_auth: boolean;
  markets: string[];
  fallback_markets: string[];
  error: string;
}

export interface MarketDataCache {
  enabled: boolean;
  root: string;
  policy: string;
}

export interface MarketDataSourcesResponse {
  sources: MarketDataSource[];
  fallback_chains: Record<string, string[]>;
  cache: MarketDataCache;
}

export interface MarketSymbolCandidate {
  symbol: string;
  name: string | null;
  market: string | null;
  type: string | null;
  source: string;
  cik?: string | null;
  exchange?: string;
  timezone?: string;
  session?: string;
}

export interface MarketSymbolSearchResponse {
  query: string;
  count: number;
  candidates: MarketSymbolCandidate[];
  sources: Record<string, string>;
  query_cache: { status: "hit" | "miss"; ttl_seconds: number };
}

export interface PortfolioProfile {
  id: string;
  label: string;
  connector: string;
  environment: string;
}

export interface PortfolioProfilesResponse { profiles: PortfolioProfile[]; }

export interface PortfolioPosition {
  symbol: string;
  quantity: number | null;
  market_value: number;
  current_price: number | null;
  unrealized_pnl: number | null;
  currency: string;
  weight: number;
}

export interface PortfolioSnapshot {
  profile: PortfolioProfile;
  as_of: string;
  summary: {
    equity: number | null;
    cash: number | null;
    gross_exposure: number;
    net_exposure: number;
    leverage: number | null;
    unrealized_pnl: number | null;
    position_count: number;
    top_concentration: number | null;
    risk_level: "low" | "moderate" | "high" | "critical";
  };
  positions: PortfolioPosition[];
  drawdown: { available: boolean; value: number | null; reason?: string };
}

export interface KnowledgeStats {
  status: string;
  db_path: string;
  document_count: number;
  chunk_count: number;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  source_path: string;
  source_hash: string;
  chunk_count: number;
  created_at: string;
}

export interface AddKnowledgeDocumentRequest {
  path: string;
  title?: string;
}

export interface KnowledgeSearchRequest {
  query: string;
  limit?: number;
}

export interface KnowledgeSearchResult {
  document_id: string;
  chunk_id: string;
  title: string;
  source_uri: string;
  source_path: string;
  chunk_index: number;
  score: number;
  text: string;
  citation: string;
}

export interface KnowledgeSearchResponse {
  status: string;
  query: string;
  count: number;
  results: KnowledgeSearchResult[];
}

export interface CommercialRegisterRequest {
  email: string;
  password: string;
  organization_name?: string;
  display_name?: string;
}

export interface CommercialLoginRequest {
  email: string;
  password: string;
}

export interface CommercialAuthStatus {
  commercial_mode: boolean;
}

export interface CommercialPrincipal {
  user_id: string;
  organization_id: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer";
  is_platform_admin: boolean;
}

export interface CommercialOrganization {
  id: string;
  name: string;
  created_at: string;
}

export interface CommercialOrganizationMembership extends CommercialOrganization {
  is_active: number | boolean;
  role: CommercialRole;
  membership_created_at: string;
}

export type CommercialRole = "owner" | "admin" | "member" | "viewer";

export interface PlatformSummary {
  users: number;
  active_users: number;
  organizations: number;
  active_organizations: number;
  platform_admins: number;
  knowledge_bases: number;
  knowledge_documents: number;
  knowledge_chunks: number;
  ingestion_jobs: number;
  ingestion_jobs_active: number;
  ingestion_jobs_failed: number;
  model_calls: number;
  audit_events: number;
  workspace_sessions?: number;
  workspace_runs?: number;
  workspace_artifacts?: number;
  runtime_jobs?: number;
  runtime_jobs_active?: number;
  runtime_jobs_failed?: number;
  commercial_db_bytes: number;
  commercial_db_path: string;
}

export type PlatformMaintenanceAction =
  | "expire_sessions"
  | "sqlite_checkpoint"
  | "sqlite_vacuum"
  | "postgres_analyze"
  | "postgres_vacuum";

export interface PlatformOperations {
  database: {
    engine: string;
    file_bytes: number;
    page_count: number;
    page_size: number;
    free_pages: number;
    journal_mode: string;
    postgres_configured: boolean;
    identity_storage?: string;
    identity_primary_counts?: Record<string, number>;
    table_counts: Record<string, number>;
  };
  runtime: {
    active: string;
    configured: string;
    available: boolean;
    redis_configured: boolean;
    postgres_configured: boolean;
    queue_name: string;
    fallback_reason: string;
    durable_job_db_bytes: number;
  };
  storage: {
    uploads_bytes: number;
    runs_bytes: number;
    sessions_bytes: number;
  };
}

export interface PlatformMaintenanceResult {
  action: PlatformMaintenanceAction;
  records_affected?: number;
  checkpoint?: number[];
  database: PlatformOperations["database"];
}

export interface PlatformRuntimeJob {
  job_id: string;
  kind: string;
  source: string;
  title: string;
  status: string;
  progress: number;
  error: string;
  retryable: boolean;
  cancelable: boolean;
  retry_count: number;
  created_at: string;
  updated_at: string;
  organization_id: string;
  organization_name: string;
  created_by_email: string;
  metadata: Record<string, unknown>;
}

export interface PlatformWorkspaceArtifact {
  artifact_type: string;
  artifact_id: string;
  organization_id: string;
  organization_name?: string | null;
  session_id: string;
  attempt_id: string;
  storage_path: string;
  created_at: string;
  updated_at: string;
  created_by_email?: string | null;
  metadata: Record<string, unknown>;
}

export interface PlatformUser {
  user_id: string;
  email: string;
  display_name: string;
  is_active: number | boolean;
  is_platform_admin: number | boolean;
  created_at: string;
  organization_count: number;
  organization_names?: string | null;
}

export interface PlatformUserUpdateRequest {
  display_name?: string;
  is_active?: boolean;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  is_active: number | boolean;
  created_at: string;
  member_count: number;
  knowledge_base_count: number;
  model_provider_count: number;
}

export interface PlatformOrganizationUpdateRequest {
  name?: string;
  is_active?: boolean;
}

export interface PlatformUsageSummary {
  organization_id: string;
  organization_name: string;
  organization_active: number | boolean;
  calls: number;
  total_tokens: number;
  estimated_cost: number;
  average_latency_ms: number;
  model_provider_count: number;
  monthly_token_soft_limit: number;
  monthly_token_hard_limit: number;
  monthly_cost_soft_limit: number;
  monthly_cost_hard_limit: number;
  token_soft_limit_reached: boolean;
  token_hard_limit_reached: boolean;
  cost_soft_limit_reached: boolean;
  cost_hard_limit_reached: boolean;
}

export interface PlatformKnowledgeBase {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_active: number | boolean;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  document_count: number;
  chunk_count: number;
  ingestion_job_count: number;
  failed_job_count: number;
}

export interface PlatformIngestionJob {
  id: string;
  organization_id: string;
  organization_name?: string | null;
  knowledge_base_id: string;
  knowledge_base_name?: string | null;
  document_id?: string | null;
  document_title?: string | null;
  status: string;
  progress: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface PlatformAuditLog extends AuditLog {
  organization_id: string;
  organization_name?: string | null;
  actor_email?: string | null;
}

export interface CommercialOrganizationMember {
  user_id: string;
  email: string;
  display_name: string;
  role: CommercialRole;
  created_at: string;
}

export interface CommercialOrganizationMemberCreateRequest {
  email: string;
  password: string;
  display_name?: string;
  role: CommercialRole;
}

export interface CommercialOrganizationMemberUpdateRequest {
  role: CommercialRole;
}

export interface CommercialModelProvider {
  id: string;
  provider: string;
  model: string;
  base_url: string;
  api_key_fingerprint?: string;
  api_key_configured: boolean;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  input_price_per_million?: number;
  output_price_per_million?: number;
  enabled: number | boolean;
  is_default: number | boolean;
  created_at: string;
  updated_at: string;
}

export interface CommercialModelProviderTestResult {
  status: "ok" | "error";
  reachable: boolean;
  provider_id: string;
  prompt: string;
  response: string;
  elapsed_ms: number;
  model: string;
  error?: string;
}

export interface CommercialModelProviderCreateRequest {
  provider: string;
  model: string;
  base_url: string;
  api_key?: string;
  temperature?: number;
  timeout_seconds?: number;
  max_retries?: number;
  input_price_per_million?: number;
  output_price_per_million?: number;
  enabled?: boolean;
  is_default?: boolean;
}

export interface CommercialModelProviderUpdateRequest {
  provider?: string;
  model?: string;
  base_url?: string;
  api_key?: string;
  clear_api_key?: boolean;
  temperature?: number;
  timeout_seconds?: number;
  max_retries?: number;
  input_price_per_million?: number;
  output_price_per_million?: number;
  enabled?: boolean;
  is_default?: boolean;
}

export interface CommercialKnowledgeBase {
  id: string;
  name: string;
  description: string;
  config: CommercialKnowledgeBaseConfig;
  access: CommercialKnowledgeBaseAccess;
  created_at: string;
  updated_at: string;
}

export type CommercialKnowledgeRetrievalMode = "hybrid" | "vector" | "keyword";

export interface CommercialKnowledgeBaseConfig {
  chunk_size: number;
  chunk_overlap: number;
  retrieval_mode: CommercialKnowledgeRetrievalMode;
  top_k: number;
  rerank_enabled?: boolean;
  rerank_candidate_limit?: number;
}

export interface CommercialKnowledgeBaseAccess {
  read_roles: CommercialRole[];
  write_roles: CommercialRole[];
}

export interface CommercialKnowledgeBackendStatus {
  organization_id: string;
  storage: string;
  target_storage: string;
  vector_storage?: {
    active: string;
    configured: string;
    pgvector_configured: boolean;
    pgvector_available: boolean;
  };
  primary: {
    provider: string;
    model: string;
    available: boolean;
    api_key_configured: boolean;
    base_url_configured: boolean;
    disabled: boolean;
  };
  fallback: {
    provider: string;
    model: string;
    available: boolean;
  };
  object_storage?: {
    backend: string;
    configured: boolean;
    available: boolean;
    bucket: string;
    error: string;
  };
}

export interface CommercialKnowledgeBaseCreateRequest {
  name: string;
  description?: string;
}

export interface CommercialKnowledgeBaseUpdateRequest {
  name?: string;
  description?: string;
  config?: Partial<CommercialKnowledgeBaseConfig>;
  access?: Partial<CommercialKnowledgeBaseAccess>;
}

export interface CommercialKnowledgeDocument {
  id: string;
  title: string;
  source_uri: string;
  source_type: string;
  status: string;
  chunk_count: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  ingestion_job_id?: string;
  ingestion_status?: string | null;
  ingestion_progress?: number | null;
  ingestion_error?: string | null;
  ingestion_started_at?: string | null;
  ingestion_completed_at?: string | null;
}

export interface CommercialKnowledgeDocumentVectorization {
  status: string;
  progress: number;
  embedded_chunks: number;
  total_chunks: number;
  backend?: string;
  reason?: string;
}

export interface CommercialKnowledgeDocumentDetail extends CommercialKnowledgeDocument {
  vectorization: CommercialKnowledgeDocumentVectorization;
  ingestion_history: CommercialIngestionJob[];
}

export interface CommercialKnowledgeChunk {
  id: string;
  chunk_index: number;
  text: string;
  character_count: number;
  embedding_dimensions: number;
  embedding_source: string;
  embedding_fallback: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CommercialKnowledgeChunkList {
  items: CommercialKnowledgeChunk[];
  count: number;
  limit: number;
  offset: number;
}

export interface CommercialKnowledgeDocumentCreateRequest {
  path: string;
  title?: string;
  chunk_size?: number;
  chunk_overlap?: number;
}

export interface CommercialKnowledgeUrlCreateRequest {
  url: string;
  title?: string;
  chunk_size?: number;
  chunk_overlap?: number;
}

export interface CommercialKnowledgeSearchRequest {
  query: string;
  limit?: number;
}

export interface CommercialKnowledgeSearchResult {
  document_id: string;
  chunk_id: string;
  title: string;
  source_uri: string;
  score: number;
  text: string;
  citation: string;
}

export interface CommercialKnowledgeSearchResponse {
  status: string;
  query: string;
  count: number;
  results: CommercialKnowledgeSearchResult[];
}

export interface CommercialKnowledgeEvaluationDataset {
  id: string;
  knowledge_base_id: string;
  name: string;
  description: string;
  case_count: number;
  latest_run_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CommercialKnowledgeEvaluationDatasetCreateRequest {
  name: string;
  description?: string;
}

export interface CommercialKnowledgeEvaluationDatasetUpdateRequest {
  name?: string;
  description?: string;
}

export interface CommercialKnowledgeEvaluationCase {
  id: string;
  query: string;
  expected_document_ids: string[];
  expected_chunk_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface CommercialKnowledgeEvaluationCaseCreateRequest {
  query: string;
  expected_document_ids?: string[];
  expected_chunk_ids?: string[];
}

export interface CommercialKnowledgeEvaluationRunResult {
  case_id: string;
  query: string;
  expected_document_ids: string[];
  expected_chunk_ids: string[];
  first_match_rank: number | null;
  retrieved: Array<{
    rank: number;
    document_id: string;
    chunk_id: string;
    title: string;
    score: number;
  }>;
}

export interface CommercialKnowledgeEvaluationRun {
  id: string;
  dataset_id: string;
  top_k: number;
  config: Record<string, unknown>;
  summary: {
    total_cases: number;
    matched_cases: number;
    hit_rate: number;
    mrr: number;
    mean_first_match_rank: number | null;
  };
  results: CommercialKnowledgeEvaluationRunResult[];
  created_at: string;
}

export interface CommercialKnowledgeEvaluationRunRequest {
  top_k?: number;
}

export interface CommercialIngestionJob {
  id: string;
  knowledge_base_id: string;
  document_id?: string | null;
  status: string;
  progress: number;
  error: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
}

export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export interface ToolPolicy {
  organization_id?: string;
  tool_name: string;
  description: string;
  is_readonly: boolean;
  risk_level: ToolRiskLevel;
  permission_scope: string;
  requires_approval: boolean;
  enabled: boolean;
  enabled_by_default?: boolean;
  source?: string;
  updated_at?: string;
}

export interface ToolPolicyUpdateRequest {
  risk_level?: ToolRiskLevel;
  permission_scope?: string;
  requires_approval?: boolean;
  enabled?: boolean;
}

export interface AuditLogFilters {
  type?: string;
  actor?: string;
  resource?: string;
  from?: string;
  to?: string;
}

export interface AuditLog {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
  user_id: string;
  created_at: string;
}

export interface ModelUsage {
  id: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  estimated_cost: number;
  session_id?: string;
  attempt_id?: string;
  run_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AdminConversationAudit {
  session: SessionItem;
  actor: Pick<CommercialPrincipal, "user_id" | "email"> & { display_name: string };
  messages: MessageItem[];
  usage: ModelUsage[];
  events: AuditLog[];
  metrics: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_tokens: number;
    estimated_cost: number;
  };
}

export interface AdminConversationAuditResponse {
  conversations: AdminConversationAudit[];
  events: AuditLog[];
}

export interface OrganizationUsagePolicy {
  organization_id: string;
  monthly_token_soft_limit: number;
  monthly_token_hard_limit: number;
  monthly_cost_soft_limit: number;
  monthly_cost_hard_limit: number;
  updated_by_user_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizationUsagePolicyUpdateRequest {
  monthly_token_soft_limit?: number;
  monthly_token_hard_limit?: number;
  monthly_cost_soft_limit?: number;
  monthly_cost_hard_limit?: number;
}

export interface OrganizationUsageSummary {
  period_start: string;
  calls: number;
  total_tokens: number;
  estimated_cost: number;
  average_latency_ms: number;
  policy: OrganizationUsagePolicy;
  token_soft_limit_reached: boolean;
  token_hard_limit_reached: boolean;
  cost_soft_limit_reached: boolean;
  cost_hard_limit_reached: boolean;
}

export interface UsageTimeseriesPoint {
  date: string;
  calls: number;
  total_tokens: number;
  estimated_cost: number;
  average_latency_ms: number;
}

export interface UsageTimeseriesResponse {
  days: number;
  series: UsageTimeseriesPoint[];
}

export interface UsageAlertEvent {
  id: string;
  organization_id: string;
  period_start: string;
  alert_type: "token_soft_limit" | "token_hard_limit" | "cost_soft_limit" | "cost_hard_limit";
  status: "open" | "acknowledged";
  metadata: Record<string, unknown>;
  created_at: string;
  acknowledged_at?: string;
  acknowledged_by_user_id?: string;
}

export interface FeedbackCreateRequest {
  target_type: string;
  target_id: string;
  session_id?: string;
  attempt_id?: string;
  run_id?: string;
  rating: -1 | 0 | 1;
  comment?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface FeedbackListParams {
  limit?: number;
  target_type?: string;
  target_id?: string;
}

export interface FeedbackEvent {
  id: string;
  organization_id: string;
  user_id: string;
  target_type: string;
  target_id: string;
  session_id?: string;
  attempt_id?: string;
  run_id?: string;
  rating: -1 | 0 | 1;
  comment: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PersistentMemoryRecord {
  id: string;
  title: string;
  description: string;
  memory_type: "user" | "feedback" | "project" | "reference";
  modified_at: number;
  content?: string;
}

export interface PersistentMemoryCreateRequest {
  title: string;
  content: string;
  memory_type?: PersistentMemoryRecord["memory_type"];
  description?: string;
}

export interface ChannelAdapterStatus {
  name: string;
  display_name: string;
  configured: boolean;
  enabled: boolean;
  available: boolean;
  loaded: boolean;
  running: boolean;
  error?: string;
  install_hint?: string;
}

export interface ChannelRuntimeStatus {
  running: boolean;
  inbound_queue: number;
  outbound_queue: number;
  session_count: number;
  channels: Record<string, ChannelAdapterStatus>;
}

export interface ChannelRuntimeActionResponse extends ChannelRuntimeStatus {
  status: string;
}

export interface ChannelPairingCommandRequest {
  channel: string;
  command: string;
}

export interface ChannelPairingCommandResponse {
  channel: string;
  reply: string;
}

// --- Types matching backend API contracts ---

export interface RunListItem {
  run_id: string;
  status: string;
  created_at: string;
  prompt?: string;
  total_return?: number;
  sharpe?: number;
  codes?: string[];
  start_date?: string;
  end_date?: string;
}

export interface RunDetailParams {
  chart_payload?: "summary";
  chart_symbol?: string;
}

export interface PriceBar {
  time: string;
  timestamp?: string;
  code?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeMarker {
  time: string;
  timestamp?: string;
  code?: string;
  side: "BUY" | "SELL";
  price: number;
  qty?: number;
  reason?: string;
  text?: string;
}

export interface EquityPoint {
  time: string;
  equity: string | number;
  drawdown: string | number;
}

export interface ValidationData {
  monte_carlo?: {
    actual_sharpe: number;
    actual_max_dd: number;
    p_value_sharpe: number;
    p_value_max_dd: number;
    simulated_sharpe_mean: number;
    simulated_sharpe_std: number;
    simulated_sharpe_p5: number;
    simulated_sharpe_p95: number;
    n_simulations: number;
    n_trades: number;
    error?: string;
  };
  bootstrap?: {
    observed_sharpe: number;
    ci_lower: number;
    ci_upper: number;
    median_sharpe: number;
    prob_positive: number;
    confidence: number;
    n_bootstrap: number;
    error?: string;
  };
  walk_forward?: {
    n_windows: number;
    windows: Array<{
      window: number;
      start: string;
      end: string;
      return: number;
      sharpe: number;
      max_dd: number;
      trades: number;
      win_rate: number;
    }>;
    profitable_windows: number;
    consistency_rate: number;
    return_mean: number;
    return_std: number;
    sharpe_mean: number;
    sharpe_std: number;
    error?: string;
  };
}

export interface RunData {
  status: string;
  run_id: string;
  prompt?: string;
  elapsed_seconds?: number;
  run_directory?: string;
  run_stage?: string;
  run_context?: Record<string, unknown>;

  metrics?: BacktestMetrics;
  artifacts?: ArtifactInfo[];
  run_card?: RunCard;
  validation?: ValidationData;

  chart_symbols?: string[];
  price_series?: Record<string, PriceBar[]>;
  indicator_series?: Record<string, Record<string, IndicatorPoint[]>>;
  trade_markers?: TradeMarker[];
  equity_curve?: EquityPoint[];
  trade_log?: Array<Record<string, string>>;
  run_logs?: Array<{ source?: string; line_number?: number; message?: string }>;
}

export interface RunCard {
  schema_version?: string;
  generated_at?: string;
  run_dir?: string;
  backtest?: Record<string, unknown>;
  reproducibility?: Record<string, unknown>;
  data_sources?: string[];
  metrics?: Record<string, unknown>;
  validation?: unknown;
  warnings?: string[];
  artifacts?: RunCardArtifact[];
  [key: string]: unknown;
}

export interface RunCardArtifact {
  path: string;
  size_bytes: number;
  sha256: string;
}

export interface BacktestMetrics {
  final_value: number;
  total_return: number;
  annual_return: number;
  max_drawdown: number;
  sharpe: number;
  win_rate: number;
  trade_count: number;
  [key: string]: number;
}


export interface IndicatorPoint {
  time: string;
  value: number;
}

export interface ArtifactInfo {
  name: string;
  path: string;
  type: string;
  size: number;
  exists: boolean;
}

export interface PineScriptResult {
  exists: boolean;
  content: string | null;
}

export interface SessionItem {
  session_id: string;
  title?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  last_attempt_id?: string;
}

// --- Goal types ---

export type GoalStatus =
  | "active"
  | "paused"
  | "waiting_user"
  | "needs_refresh"
  | "insufficient_evidence"
  | "compliance_blocked"
  | "blocked"
  | "budget_limited"
  | "usage_limited"
  | "complete"
  | "cancelled"
  | "superseded";

export type GoalRiskTier =
  | "research_general"
  | "market_specific_short_term"
  | "personalized_advice_or_position_sizing";

export interface GoalRecord {
  goal_id: string;
  session_id: string;
  status: GoalStatus;
  objective: string;
  ui_summary: string;
  source: string;
  protocol: string;
  risk_tier: GoalRiskTier;
  token_budget?: number | null;
  tokens_used: number;
  turn_budget?: number | null;
  turns_used: number;
  time_budget_seconds?: number | null;
  time_used_seconds: number;
  budget_wrapup_sent: boolean;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  recap?: string | null;
}

export interface GoalClaim {
  claim_id: string;
  goal_id: string;
  session_id: string;
  claim_type: string;
  text: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface GoalCriterion {
  criterion_id: string;
  goal_id: string;
  session_id: string;
  text: string;
  required: boolean;
  status: string;
  freshness_requirement?: string | null;
  protocol_step?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalEvidence {
  evidence_id: string;
  goal_id: string;
  session_id: string;
  text: string;
  criterion_id?: string | null;
  claim_id?: string | null;
  evidence_type: string;
  tool_call_id?: string | null;
  run_id?: string | null;
  source_provider?: string | null;
  source_type?: string | null;
  source_uri?: string | null;
  symbol_universe: string[];
  benchmark: string[];
  timeframe?: string | null;
  method?: string | null;
  assumptions: Record<string, unknown>;
  artifact_path?: string | null;
  artifact_hash?: string | null;
  retrieved_at: string;
  data_as_of?: string | null;
  freshness_status: string;
  verification_status: string;
  confidence?: string | null;
  caveat?: string | null;
  contradicts_claim_ids: string[];
  created_at: string;
}

export interface GoalSnapshot {
  goal: GoalRecord;
  claims: GoalClaim[];
  criteria: GoalCriterion[];
  evidence: GoalEvidence[];
  evidence_count: number;
}

export interface CreateGoalRequest {
  objective: string;
  criteria?: string[];
  ui_summary?: string;
  protocol?: string;
  risk_tier?: GoalRiskTier;
  token_budget?: number;
  turn_budget?: number;
  time_budget_seconds?: number;
}

export interface AddGoalEvidenceRequest {
  goal_id: string;
  expected_goal_id: string;
  text: string;
  criterion_id?: string | null;
  claim_id?: string | null;
  evidence_type?: string;
  tool_call_id?: string | null;
  run_id?: string | null;
  source_provider?: string | null;
  source_type?: string | null;
  source_uri?: string | null;
  symbol_universe?: string[];
  benchmark?: string[];
  timeframe?: string | null;
  method?: string | null;
  assumptions?: Record<string, unknown>;
  artifact_path?: string | null;
  artifact_hash?: string | null;
  data_as_of?: string | null;
  confidence?: string | null;
  caveat?: string | null;
  contradicts_claim_ids?: string[];
}

export interface UpdateGoalRequest {
  goal_id: string;
  expected_goal_id: string;
  objective?: string;
  ui_summary?: string;
}

export interface UpdateGoalResponse {
  goal: GoalRecord;
  snapshot: GoalSnapshot;
}

export interface AddGoalEvidenceResponse {
  evidence: GoalEvidence;
  snapshot: GoalSnapshot;
}

export interface GoalAuditRowRequest {
  criterion_id: string;
  result: string;
  evidence_ids?: string[];
  notes?: string;
}

export interface UpdateGoalStatusRequest {
  goal_id: string;
  expected_goal_id: string;
  status: GoalStatus;
  audit?: GoalAuditRowRequest[];
  recap?: string | null;
}

export interface UpdateGoalStatusResponse {
  goal: GoalRecord;
  snapshot: GoalSnapshot;
}

// --- Alpha Zoo types ---

export interface AlphaListParams {
  zoo?: string;
  theme?: string;
  universe?: string;
  limit?: number;
}

export interface AlphaSummary {
  id: string;
  zoo: string;
  theme: string[];
  universe: string[];
  nickname?: string;
  decay_horizon?: number | null;
  min_warmup_bars?: number | null;
  requires_sector?: boolean;
}

export interface AlphaListResponse {
  status: string;
  alphas: AlphaSummary[];
  total: number;
  returned: number;
  truncated: boolean;
}

export interface AlphaDetail {
  id: string;
  zoo: string;
  module_path?: string;
  meta: Record<string, unknown>;
}

export interface AlphaDetailResponse {
  status: string;
  alpha: AlphaDetail;
  source_code: string;
}

export interface AlphaBenchRequest {
  zoo: string;
  universe: string;
  period: string;
  top?: number;
}

export interface AlphaBenchTopRow {
  id: string;
  ic_mean: number;
  ir: number;
  theme: string[];
  formula_latex: string;
  category: "alive" | "reversed" | "dead";
}

export interface AlphaBenchResult {
  alive: number;
  reversed: number;
  dead: number;
  skipped?: number;
  top5_by_ir: AlphaBenchTopRow[];
  dead_examples: AlphaBenchTopRow[];
  by_theme: Record<string, { alive: number; reversed: number; dead: number }>;
}

export interface AlphaCompareRequest {
  alpha_ids: string[];
  universe: string;
  period: string;
  /** One of: ir | ic_mean | ic_positive_ratio | ic_count (default ir). */
  sort?: string;
}

export interface AlphaCompareRow {
  rank: number;
  id: string;
  zoo: string;
  ic_mean: number;
  ic_std: number;
  ir: number;
  ic_positive_ratio: number;
  ic_count: number;
  /** `delta_<sort>_vs_best` — gap to the top-ranked alpha on the active metric. */
  [deltaKey: string]: number | string;
}

export interface AlphaCompareSkip {
  id: string;
  reason: string;
}

export interface AlphaCompareResult {
  universe: string;
  period: string;
  sort: string;
  n_compared: number;
  n_skipped: number;
  winner: string;
  ranking: AlphaCompareRow[];
  skipped: AlphaCompareSkip[];
}

// --- Connector runtime channel types ---

/** One mandate profile inside a `mandate.proposal` event (SPEC Consent §1). */
export interface MandateProfile {
  ordinal: number;
  label: string;
  /** Concrete ticker list, or a structural universe descriptor (e.g. "tech_sector"). */
  universe: string[] | string;
  max_order_usd: number;
  daily_trade_cap: number;
  /** "none" for cash-only, otherwise a leverage descriptor/multiple. */
  leverage: string | number;
  instruments: string[];
  notes?: string;
}

/** Account block of a `mandate.proposal` event. */
export interface MandateProposalAccount {
  broker: string;
  type: string;
  funded_by: string;
}

/** Payload of the `mandate.proposal` SSE event (SPEC Consent §1). */
export interface MandateProposal {
  type?: string;
  proposal_id: string;
  session_id?: string;
  intent_normalized?: string;
  account?: MandateProposalAccount;
  ceilings_ref?: string;
  profiles: MandateProfile[];
  funding_note?: string;
  halt_note?: string;
  /** Present only when this proposal was triggered by a mandate breach (SPEC Consent §3). */
  reauth_for?: { breach_id?: string } | null;
}

/** Payload of the `mandate.committed` SSE event (SPEC Consent §1 COMMIT). */
export interface MandateCommitted {
  proposal_id?: string;
  mandate_id?: string;
  consent_record_id?: string;
  selected_ordinal?: number;
  broker?: string;
  /** Resolved limits, surfaced for the compact active-mandate badge. */
  max_order_usd?: number;
  daily_trade_cap?: number;
  expires_at?: string;
}

/** Payload of the `live.halted` SSE event (SPEC Consent §4). */
export interface LiveHalted {
  broker?: string | null;
  tripped_at?: string;
  by?: string;
  reason?: string;
}

/** Payload of the `live.action` SSE event (SPEC Consent §5 audit notify). */
export interface LiveAction {
  audit_id?: string;
  ts?: string;
  kind: string;
  intent_normalized?: string;
  outcome?: string;
  broker?: string;
  remote_tool?: string;
  error?: string | null;
}

export interface CommitMandateRequest {
  broker: string;
  proposal_id: string;
  selected_ordinal: number;
  /** Present only on the adjust path (SPEC Consent §3); null otherwise. */
  adjustments?: Record<string, unknown> | null;
  /** Explicit affirmative consent; the surface sets it on the user's click. */
  consent_ack: boolean;
  session_id?: string;
  account_ref?: string;
  lifetime_days?: number;
}

export interface CommitMandateResponse {
  mandate_id: string;
  consent_record_id: string;
  selected_ordinal?: number;
  broker?: string;
  max_order_usd?: number;
  daily_trade_cap?: number;
  expires_at?: string;
}

export interface HaltLiveResponse {
  halted: boolean;
  broker?: string | null;
  reason: string;
  sentinel: string;
}

export interface LiveAuthorizeRequest {
  broker: string;
}

export interface LiveAuthorizeResponse {
  broker: string;
  connector_profile: string;
  oauth_token_present: boolean;
  instruction: string;
  note?: string;
}

/** Mandate limits surfaced inside a `GET /live/status` broker entry (SPEC §7.5). */
export interface LiveMandateLimits {
  max_order_notional_usd?: number;
  max_total_exposure_usd?: number;
  max_leverage?: number;
  max_trades_per_day?: number;
  allowed_instruments?: string[];
  account_funding_usd?: number;
  [key: string]: unknown;
}

/** Active mandate block of a `GET /live/status` broker entry. */
export interface LiveMandateStatus {
  broker?: string;
  mandate_id?: string;
  account_ref?: string;
  created_at?: string;
  limits?: LiveMandateLimits;
  /** ISO timestamp the mandate auto-expires (SPEC §7.5 #7 proactive expiry). */
  expires_at?: string;
  expires_in_seconds?: number | null;
  expired?: boolean;
}

/** Runner liveness block of a `GET /live/status` broker entry (SPEC §7.5 #3). */
export interface LiveRunnerLiveness {
  broker?: string;
  alive: boolean;
  /** Unix epoch seconds of the last heartbeat tick; null if the runner never started. */
  last_tick?: number | string | null;
  last_tick_age_seconds?: number | null;
}

export interface LiveBrokerAuthStatus {
  broker: string;
  oauth_token_present: boolean;
  is_live_broker: boolean;
}

/** One broker entry in the `GET /live/status` response. */
export interface LiveBrokerStatus {
  auth: LiveBrokerAuthStatus;
  mandate?: LiveMandateStatus | null;
  runner: LiveRunnerLiveness;
  halted: boolean;
}

/** Response of `GET /live/status` (SPEC §7.5 runner status panel + C2). */
export interface LiveStatus {
  brokers: LiveBrokerStatus[];
  global_halted: boolean;
}

export type RuntimeJobStatus = "queued" | "pending" | "running" | "completed" | "done" | "failed" | "error" | "cancelled";

export interface RuntimeJob {
  job_id: string;
  kind: string;
  title: string;
  status: RuntimeJobStatus | string;
  progress: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuntimeJobActionResponse {
  status: string;
  job_id: string;
}

/** Response of `POST /live/runner/start|stop`. */
export interface LiveRunnerResponse {
  broker: string;
  started?: boolean;
  already_running?: boolean;
  stopped?: boolean;
  was_running?: boolean;
}

export interface MessageItem {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  linked_attempt_id?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionHistoryMatch {
  session_id: string;
  title: string;
  started_at: string;
  message_count: number;
  snippet: string;
  citation: string;
}

export interface SessionHistorySearchResponse {
  query: string;
  count: number;
  results: SessionHistoryMatch[];
}

export type ExecutionMode = "auto" | "react" | "plan_execute";

export interface ExecutionPlanStep {
  step_id: string;
  title: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  dependencies: string[];
  tool_names: string[];
  started_at?: string | null;
  completed_at?: string | null;
  elapsed_ms?: number | null;
  summary?: string;
  error?: string;
}

export interface ApprovalRecord {
  approval_id: string;
  session_id: string;
  attempt_id: string;
  step_id: string;
  tool_name: string;
  risk_level: string;
  input_summary: Record<string, string>;
  status: "pending" | "approved" | "rejected" | "expired";
  requested_at: string;
  expires_at: string;
  resolved_at?: string;
}

export interface AttemptExecution {
  attempt_id: string;
  session_id: string;
  status: string;
  execution_mode: ExecutionMode;
  plan: ExecutionPlanStep[];
  current_step_id?: string | null;
  snapshot: Record<string, unknown>;
  approvals: ApprovalRecord[];
}

export interface SwarmPresetAgent {
  id: string;
  role: string;
  system_prompt: string;
  tools: string[];
  skills: string[];
  max_iterations: number;
  timeout_seconds: number;
  model_name?: string | null;
  model_provider_id?: string | null;
  max_retries: number;
  task_count?: number;
}

export interface SwarmPresetAgentList {
  preset_name: string;
  title: string;
  description: string;
  agents: SwarmPresetAgent[];
}

export interface SwarmPresetAgentRequest {
  id: string;
  role: string;
  system_prompt: string;
  tools: string[];
  skills: string[];
  max_iterations: number;
  timeout_seconds: number;
  model_name?: string | null;
  model_provider_id?: string | null;
  max_retries: number;
}
