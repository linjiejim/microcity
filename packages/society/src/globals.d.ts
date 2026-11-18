// Node ≥17 与浏览器都提供 structuredClone；sim 包不引 DOM/Node 类型，这里单独声明
declare function structuredClone<T>(value: T): T;
