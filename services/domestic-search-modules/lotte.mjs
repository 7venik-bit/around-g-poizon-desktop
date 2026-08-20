export function lotteSearchModule() {
  return [
    { id: "lotte-general", module: "lotte", store: "롯데온", linkOnly: true, domesticChannel: "lotte-general", renderCount: true },
    { id: "lotte-department", module: "lotte", store: "롯데온 백화점", linkOnly: true, domesticChannel: "lotte-department", renderCount: true },
    { id: "lotte-outlet", module: "lotte", store: "롯데온 아울렛", linkOnly: true, domesticChannel: "lotte-outlet", renderCount: true },
  ];
}
