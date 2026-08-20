export function ssgSearchModule() {
  return [
    { id: "ssg-general", module: "ssg", store: "SSG", linkOnly: true, domesticChannel: "ssg-general", renderCount: true },
    { id: "ssg-department", module: "ssg", store: "SSG 백화점", linkOnly: true, domesticChannel: "ssg-department", renderCount: true },
    { id: "ssg-outlet", module: "ssg", store: "SSG 아울렛", linkOnly: true, domesticChannel: "ssg-outlet", renderCount: true },
  ];
}
