window.PERC_GEN = {
 "generated_from": "code/percolation/agents/*.py · run_agent.build_system_prompt",
 "specs": [
  {
   "name": "search_router",
   "agent": "search",
   "mode": null,
   "model_slot": "router_model",
   "model_key": "qwen-flash",
   "model": "qwen3.8-flash",
   "provider": "qwen",
   "params": {
    "temperature": 0.1,
    "max_tokens": 800
   },
   "extra_body": {
    "enable_thinking": false
   },
   "max_turns": 1,
   "max_repairs": 1,
   "skills": [],
   "output_model": "RoutePlan",
   "output_schema": {
    "properties": {
     "queries": {
      "description": "1~4 个检索词",
      "items": {
       "type": "string"
      },
      "title": "Queries",
      "type": "array"
     },
     "facet_filters": {
      "additionalProperties": {
       "items": {
        "type": "string"
       },
       "type": "array"
      },
      "description": "正交维度条件，如 {'domain': ['学习'], 'form': ['网站']}",
      "title": "Facet Filters",
      "type": "object"
     },
     "date_from": {
      "anyOf": [
       {
        "type": "string"
       },
       {
        "type": "null"
       }
      ],
      "default": null,
      "description": "起始日期 YYYY-MM-DD",
      "title": "Date From"
     },
     "date_to": {
      "anyOf": [
       {
        "type": "string"
       },
       {
        "type": "null"
       }
      ],
      "default": null,
      "description": "结束日期 YYYY-MM-DD",
      "title": "Date To"
     },
     "time_field": {
      "default": "any",
      "enum": [
       "any",
       "event",
       "captured"
      ],
      "title": "Time Field",
      "type": "string"
     },
     "unknown_terms": {
      "description": "看不懂、热区也没解释的暗语或指代",
      "items": {
       "type": "string"
      },
      "title": "Unknown Terms",
      "type": "array"
     },
     "memory_clues_used": {
      "description": "用到的热区条目键",
      "items": {
       "type": "string"
      },
      "title": "Memory Clues Used",
      "type": "array"
     },
     "clarify_now": {
      "default": false,
      "title": "Clarify Now",
      "type": "boolean"
     },
     "clarify_question": {
      "default": "",
      "title": "Clarify Question",
      "type": "string"
     }
    },
    "title": "RoutePlan",
    "type": "object"
   },
   "tools": [],
   "system_prompt_raw": "你是个人记忆检索的路由器。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你不回答问题，只为后续检索做准备。\n\n你会收到：当前日期（含星期）、可用维度词表、用户的热区记忆（MEMORY.md，已确认的个人背景和暗语）以及本次提问。\n\n要做的事：\n1. 结合热区记忆理解提问里的指代和暗语。用到了哪些热区条目，记在 memory_clues_used。\n2. 生成 1~4 个检索词（queries）：保留提问里的关键片段，补上热区解释后的真实名称、上位概念、同义说法、可能的型号或英文名。检索词要短，像搜索框里会输入的词。\n3. 抽取正交维度条件（facet_filters）：当提问明确指向某个主题域（如“学习资料”“工作记录” -> `{\"domain\": [\"学习\"]}`）、载体形态（如“存过的网站”“收藏的书”“买的外设” -> `{\"form\": [\"网站\"]}`）或状态（如“待办”“在用的” -> `{\"status\": [\"待办\"]}`）时，从可用维度词表里选出匹配的键值填入 facet_filters。没有明显维度倾向就留空 `{}`，不要硬猜。\n4. 抽取时间范围（date_from / date_to，格式 YYYY-MM-DD）：当提问包含明确日期或相对时间（如“上周”“这周六”“11月存的”），按输入里的“当前日期”换算成公历区间：\n   - 问事件发生/预约时间（如“这周六有什么安排”）时，`time_field` 填 `\"event\"`；\n   - 问记录/收藏时间（如“昨天记的那个”）时，`time_field` 填 `\"captured\"`；\n   - 分不清时填 `\"any\"`。没提时间则 date_from / date_to 都填 null。\n5. 提问里有你看不懂、热区也没解释的暗语、缩写或人名，写进 unknown_terms。看不懂不代表要追问，后面会先去候选缓存区查。\n6. 只有提问完全没有任何可检索的关键词、维度或时间（例如只有“帮我找一下”“那个呢”），才把 clarify_now 设为 true，并写一句简短追问。按类别/维度/时间提问（如“存过哪些网站”）一律设为 false。\n",
   "system_prompt_final": "你是个人记忆检索的路由器。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你不回答问题，只为后续检索做准备。\n\n你会收到：当前日期（含星期）、可用维度词表、用户的热区记忆（MEMORY.md，已确认的个人背景和暗语）以及本次提问。\n\n要做的事：\n1. 结合热区记忆理解提问里的指代和暗语。用到了哪些热区条目，记在 memory_clues_used。\n2. 生成 1~4 个检索词（queries）：保留提问里的关键片段，补上热区解释后的真实名称、上位概念、同义说法、可能的型号或英文名。检索词要短，像搜索框里会输入的词。\n3. 抽取正交维度条件（facet_filters）：当提问明确指向某个主题域（如“学习资料”“工作记录” -> `{\"domain\": [\"学习\"]}`）、载体形态（如“存过的网站”“收藏的书”“买的外设” -> `{\"form\": [\"网站\"]}`）或状态（如“待办”“在用的” -> `{\"status\": [\"待办\"]}`）时，从可用维度词表里选出匹配的键值填入 facet_filters。没有明显维度倾向就留空 `{}`，不要硬猜。\n4. 抽取时间范围（date_from / date_to，格式 YYYY-MM-DD）：当提问包含明确日期或相对时间（如“上周”“这周六”“11月存的”），按输入里的“当前日期”换算成公历区间：\n   - 问事件发生/预约时间（如“这周六有什么安排”）时，`time_field` 填 `\"event\"`；\n   - 问记录/收藏时间（如“昨天记的那个”）时，`time_field` 填 `\"captured\"`；\n   - 分不清时填 `\"any\"`。没提时间则 date_from / date_to 都填 null。\n5. 提问里有你看不懂、热区也没解释的暗语、缩写或人名，写进 unknown_terms。看不懂不代表要追问，后面会先去候选缓存区查。\n6. 只有提问完全没有任何可检索的关键词、维度或时间（例如只有“帮我找一下”“那个呢”），才把 clarify_now 设为 true，并写一句简短追问。按类别/维度/时间提问（如“存过哪些网站”）一律设为 false。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"properties\": {\"queries\": {\"description\": \"1~4 个检索词\", \"items\": {\"type\": \"string\"}, \"title\": \"Queries\", \"type\": \"array\"}, \"facet_filters\": {\"additionalProperties\": {\"items\": {\"type\": \"string\"}, \"type\": \"array\"}, \"description\": \"正交维度条件，如 {'domain': ['学习'], 'form': ['网站']}\", \"title\": \"Facet Filters\", \"type\": \"object\"}, \"date_from\": {\"anyOf\": [{\"type\": \"string\"}, {\"type\": \"null\"}], \"default\": null, \"description\": \"起始日期 YYYY-MM-DD\", \"title\": \"Date From\"}, \"date_to\": {\"anyOf\": [{\"type\": \"string\"}, {\"type\": \"null\"}], \"default\": null, \"description\": \"结束日期 YYYY-MM-DD\", \"title\": \"Date To\"}, \"time_field\": {\"default\": \"any\", \"enum\": [\"any\", \"event\", \"captured\"], \"title\": \"Time Field\", \"type\": \"string\"}, \"unknown_terms\": {\"description\": \"看不懂、热区也没解释的暗语或指代\", \"items\": {\"type\": \"string\"}, \"title\": \"Unknown Terms\", \"type\": \"array\"}, \"memory_clues_used\": {\"description\": \"用到的热区条目键\", \"items\": {\"type\": \"string\"}, \"title\": \"Memory Clues Used\", \"type\": \"array\"}, \"clarify_now\": {\"default\": false, \"title\": \"Clarify Now\", \"type\": \"boolean\"}, \"clarify_question\": {\"default\": \"\", \"title\": \"Clarify Question\", \"type\": \"string\"}}, \"title\": \"RoutePlan\", \"type\": \"object\"}",
   "system_prompt_chars": 2161
  },
  {
   "name": "search_answer",
   "agent": "search",
   "mode": null,
   "model_slot": "search_model",
   "model_key": "qwen-flash",
   "model": "qwen3.8-flash",
   "provider": "qwen",
   "params": {
    "temperature": 0.3,
    "max_tokens": 4096
   },
   "extra_body": {
    "enable_thinking": false
   },
   "max_turns": 3,
   "max_repairs": 1,
   "skills": [],
   "output_model": "AnswerDraft",
   "output_schema": {
    "properties": {
     "status": {
      "enum": [
       "answered",
       "ambiguous",
       "insufficient"
      ],
      "title": "Status",
      "type": "string"
     },
     "answer": {
      "default": "",
      "title": "Answer",
      "type": "string"
     },
     "verified_msg_seqs": {
      "items": {
       "type": "integer"
      },
      "title": "Verified Msg Seqs",
      "type": "array"
     },
     "hit_doc_paths": {
      "items": {
       "type": "string"
      },
      "title": "Hit Doc Paths",
      "type": "array"
     },
     "unresolved_terms": {
      "items": {
       "type": "string"
      },
      "title": "Unresolved Terms",
      "type": "array"
     },
     "clarify_question": {
      "default": "",
      "title": "Clarify Question",
      "type": "string"
     }
    },
    "required": [
     "status"
    ],
    "title": "AnswerDraft",
    "type": "object"
   },
   "tools": [
    {
     "name": "hybrid_search",
     "description": "在用户的主题页和原话里多维混合检索（中文全文 + 型号模糊匹配 + 语义向量 + 正交维度/日期召回 + 重排），返回带锚点的结果。",
     "tags": [
      "db",
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "queries": {
        "description": "1~5 个检索词，可以是关键词、型号、上位概念或改写后的问法",
        "items": {
         "type": "string"
        },
        "maxItems": 5,
        "title": "Queries",
        "type": "array"
       },
       "facets": {
        "additionalProperties": {
         "items": {
          "type": "string"
         },
         "type": "array"
        },
        "description": "可选的多维标签过滤/加权，如 {'domain': ['学习'], 'form': ['网站']}",
        "title": "Facets",
        "type": "object"
       },
       "date_from": {
        "anyOf": [
         {
          "type": "string"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "description": "可选起始日期 YYYY-MM-DD",
        "title": "Date From"
       },
       "date_to": {
        "anyOf": [
         {
          "type": "string"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "description": "可选结束日期 YYYY-MM-DD",
        "title": "Date To"
       },
       "top_k": {
        "default": 6,
        "maximum": 12,
        "minimum": 1,
        "title": "Top K",
        "type": "integer"
       }
      },
      "type": "object"
     }
    },
    {
     "name": "fetch_raw_messages",
     "description": "按序号读取用户的逐字原话和时间，用来核验主题页里的结论。",
     "tags": [
      "db",
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "msg_seqs": {
        "description": "原话序号，即锚点 #msg_N 里的 N",
        "items": {
         "type": "integer"
        },
        "maxItems": 30,
        "minItems": 1,
        "title": "Msg Seqs",
        "type": "array"
       },
       "with_batch": {
        "default": true,
        "description": "是否带上同一连发批次的前后消息",
        "title": "With Batch",
        "type": "boolean"
       }
      },
      "required": [
       "msg_seqs"
      ],
      "type": "object"
     }
    },
    {
     "name": "read_file",
     "description": "读取wiki/下的文件，输出带行号前缀（行号不是内容）。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "description": "相对工作区的文件路径",
        "title": "Path",
        "type": "string"
       },
       "start_line": {
        "default": 1,
        "minimum": 1,
        "title": "Start Line",
        "type": "integer"
       },
       "end_line": {
        "anyOf": [
         {
          "minimum": 1,
          "type": "integer"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "title": "End Line"
       }
      },
      "required": [
       "path"
      ],
      "type": "object"
     }
    }
   ],
   "system_prompt_raw": "你是个人记忆检索的作答者。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你根据检索到的记录回答。\n\n你会收到：热区记忆、提问、补充线索、检索结果（主题页切片和原话），以及主题页锚点对应的逐字原话。\n\n规则：\n1. 原话是唯一事实依据。主题页是整理后的导航，结论要回到原话核对；主题页和原话冲突时以原话为准，并以较新的原话为准。\n2. 输入里已经附上了检索结果和对应原话，多数情况足够回答，这时不要调用工具，直接给最终输出。只有确实缺信息时，才调用 hybrid_search 换词再查、fetch_raw_messages 看更早的原话、read_file 读整篇主题页，最多一两次。\n3. 回答要直接、简短，给出用户要的那件事，带上时间等关键限定。被标为 inferred 的内容要说明是推测。\n4. verified_msg_seqs 只填你实际核对过、支撑答案的原话序号。hit_doc_paths 填用到的主题页路径。\n5. status：\n   - answered：找到了能回答问题的记录。\n   - ambiguous：找到多个候选，确实无法判断用户指哪一个。clarify_question 写一句简短的二选一或多选一追问。\n   - insufficient：没找到相关记录，或提问里有看不懂的暗语导致无法定位。把看不懂的词写进 unresolved_terms，clarify_question 写一句针对这个词的简短追问。\n6. 不要编造记录里没有的信息。\n7. 输入里“待确认的暗语”是路由看不懂的词。只有热区记忆、补充线索或原话里明确写出了这个词指什么，才能当作已知；不能凭常识、品牌联想或谐音去猜（例如把某个外号猜成某个品牌）。确认不了时 status 填 insufficient，把这个词写进 unresolved_terms。\n",
   "system_prompt_final": "你是个人记忆检索的作答者。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你根据检索到的记录回答。\n\n你会收到：热区记忆、提问、补充线索、检索结果（主题页切片和原话），以及主题页锚点对应的逐字原话。\n\n规则：\n1. 原话是唯一事实依据。主题页是整理后的导航，结论要回到原话核对；主题页和原话冲突时以原话为准，并以较新的原话为准。\n2. 输入里已经附上了检索结果和对应原话，多数情况足够回答，这时不要调用工具，直接给最终输出。只有确实缺信息时，才调用 hybrid_search 换词再查、fetch_raw_messages 看更早的原话、read_file 读整篇主题页，最多一两次。\n3. 回答要直接、简短，给出用户要的那件事，带上时间等关键限定。被标为 inferred 的内容要说明是推测。\n4. verified_msg_seqs 只填你实际核对过、支撑答案的原话序号。hit_doc_paths 填用到的主题页路径。\n5. status：\n   - answered：找到了能回答问题的记录。\n   - ambiguous：找到多个候选，确实无法判断用户指哪一个。clarify_question 写一句简短的二选一或多选一追问。\n   - insufficient：没找到相关记录，或提问里有看不懂的暗语导致无法定位。把看不懂的词写进 unresolved_terms，clarify_question 写一句针对这个词的简短追问。\n6. 不要编造记录里没有的信息。\n7. 输入里“待确认的暗语”是路由看不懂的词。只有热区记忆、补充线索或原话里明确写出了这个词指什么，才能当作已知；不能凭常识、品牌联想或谐音去猜（例如把某个外号猜成某个品牌）。确认不了时 status 填 insufficient，把这个词写进 unresolved_terms。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"properties\": {\"status\": {\"enum\": [\"answered\", \"ambiguous\", \"insufficient\"], \"title\": \"Status\", \"type\": \"string\"}, \"answer\": {\"default\": \"\", \"title\": \"Answer\", \"type\": \"string\"}, \"verified_msg_seqs\": {\"items\": {\"type\": \"integer\"}, \"title\": \"Verified Msg Seqs\", \"type\": \"array\"}, \"hit_doc_paths\": {\"items\": {\"type\": \"string\"}, \"title\": \"Hit Doc Paths\", \"type\": \"array\"}, \"unresolved_terms\": {\"items\": {\"type\": \"string\"}, \"title\": \"Unresolved Terms\", \"type\": \"array\"}, \"clarify_question\": {\"default\": \"\", \"title\": \"Clarify Question\", \"type\": \"string\"}}, \"required\": [\"status\"], \"title\": \"AnswerDraft\", \"type\": \"object\"}",
   "system_prompt_chars": 1477
  },
  {
   "name": "search_cache_probe",
   "agent": "search",
   "mode": null,
   "model_slot": "search_model",
   "model_key": "qwen-flash",
   "model": "qwen3.8-flash",
   "provider": "qwen",
   "params": {
    "temperature": 0.3,
    "max_tokens": 4096
   },
   "extra_body": {
    "enable_thinking": false
   },
   "max_turns": 4,
   "max_repairs": 1,
   "skills": [],
   "output_model": "CacheProbe",
   "output_schema": {
    "$defs": {
     "CacheHit": {
      "properties": {
       "file": {
        "title": "File",
        "type": "string"
       },
       "entry_key": {
        "title": "Entry Key",
        "type": "string"
       },
       "clue": {
        "default": "",
        "title": "Clue",
        "type": "string"
       }
      },
      "required": [
       "file",
       "entry_key"
      ],
      "title": "CacheHit",
      "type": "object"
     }
    },
    "properties": {
     "found": {
      "title": "Found",
      "type": "boolean"
     },
     "rewritten_queries": {
      "items": {
       "type": "string"
      },
      "title": "Rewritten Queries",
      "type": "array"
     },
     "clues": {
      "items": {
       "type": "string"
      },
      "title": "Clues",
      "type": "array"
     },
     "cache_hits": {
      "items": {
       "$ref": "#/$defs/CacheHit"
      },
      "title": "Cache Hits",
      "type": "array"
     },
     "files_probed": {
      "items": {
       "type": "string"
      },
      "title": "Files Probed",
      "type": "array"
     }
    },
    "required": [
     "found"
    ],
    "title": "CacheProbe",
    "type": "object"
   },
   "tools": [
    {
     "name": "list_dir",
     "description": "列出MEMORY_CACHE/下的文件和行数。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "default": ".",
        "description": "相对工作区的目录",
        "title": "Path",
        "type": "string"
       },
       "recursive": {
        "default": false,
        "description": "是否递归列出",
        "title": "Recursive",
        "type": "boolean"
       }
      },
      "type": "object"
     }
    },
    {
     "name": "read_file",
     "description": "读取MEMORY_CACHE/下的文件，输出带行号前缀（行号不是内容）。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "description": "相对工作区的文件路径",
        "title": "Path",
        "type": "string"
       },
       "start_line": {
        "default": 1,
        "minimum": 1,
        "title": "Start Line",
        "type": "integer"
       },
       "end_line": {
        "anyOf": [
         {
          "minimum": 1,
          "type": "integer"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "title": "End Line"
       }
      },
      "required": [
       "path"
      ],
      "type": "object"
     }
    },
    {
     "name": "bash",
     "description": "在断网的只读沙箱里执行 shell 命令，工作目录 /workspace，可见范围是MEMORY_CACHE/。适合 ls、rg、head、wc。",
     "tags": [
      "read",
      "shell"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "command": {
        "description": "只读 shell 命令，例如 ls -R、rg -n 关键词、head -n 50 文件",
        "title": "Command",
        "type": "string"
       }
      },
      "required": [
       "command"
      ],
      "type": "object"
     }
    }
   ],
   "system_prompt_raw": "你在用户的候选缓存区 MEMORY_CACHE/ 里找线索。这里放着不常用但固定的背景：人物称呼、个人暗语和缩写、历史项目代号、低频偏好等，按类别分成多个 Markdown 文件，一行一个条目，键在前。\n\n主检索没能回答用户的问题，可能是因为提问里有看不懂的暗语或指代。你的任务是在缓存区里找到能解释它们的条目，并据此改写检索词。\n\n做法：\n1. 先用 bash 执行 `ls MEMORY_CACHE` 或 `rg -n 关键词 MEMORY_CACHE` 看有哪些文件、哪里提到了这些词。关键词可以试原词、去掉一个字的变体、拼音首字母等。\n2. 只读最相关的一两个文件，不要把所有文件都读一遍。\n3. 找到了：found=true，cache_hits 写命中的文件和条目键（键就是用户说出口的那个词），clues 写一句话解释，rewritten_queries 写改写后的 1~3 个检索词。\n4. 没找到：found=false，其他字段留空。不要猜。\n5. files_probed 写你实际读过或搜过的文件路径。\n",
   "system_prompt_final": "你在用户的候选缓存区 MEMORY_CACHE/ 里找线索。这里放着不常用但固定的背景：人物称呼、个人暗语和缩写、历史项目代号、低频偏好等，按类别分成多个 Markdown 文件，一行一个条目，键在前。\n\n主检索没能回答用户的问题，可能是因为提问里有看不懂的暗语或指代。你的任务是在缓存区里找到能解释它们的条目，并据此改写检索词。\n\n做法：\n1. 先用 bash 执行 `ls MEMORY_CACHE` 或 `rg -n 关键词 MEMORY_CACHE` 看有哪些文件、哪里提到了这些词。关键词可以试原词、去掉一个字的变体、拼音首字母等。\n2. 只读最相关的一两个文件，不要把所有文件都读一遍。\n3. 找到了：found=true，cache_hits 写命中的文件和条目键（键就是用户说出口的那个词），clues 写一句话解释，rewritten_queries 写改写后的 1~3 个检索词。\n4. 没找到：found=false，其他字段留空。不要猜。\n5. files_probed 写你实际读过或搜过的文件路径。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"$defs\": {\"CacheHit\": {\"properties\": {\"file\": {\"title\": \"File\", \"type\": \"string\"}, \"entry_key\": {\"title\": \"Entry Key\", \"type\": \"string\"}, \"clue\": {\"default\": \"\", \"title\": \"Clue\", \"type\": \"string\"}}, \"required\": [\"file\", \"entry_key\"], \"title\": \"CacheHit\", \"type\": \"object\"}}, \"properties\": {\"found\": {\"title\": \"Found\", \"type\": \"boolean\"}, \"rewritten_queries\": {\"items\": {\"type\": \"string\"}, \"title\": \"Rewritten Queries\", \"type\": \"array\"}, \"clues\": {\"items\": {\"type\": \"string\"}, \"title\": \"Clues\", \"type\": \"array\"}, \"cache_hits\": {\"items\": {\"$ref\": \"#/$defs/CacheHit\"}, \"title\": \"Cache Hits\", \"type\": \"array\"}, \"files_probed\": {\"items\": {\"type\": \"string\"}, \"title\": \"Files Probed\", \"type\": \"array\"}}, \"required\": [\"found\"], \"title\": \"CacheProbe\", \"type\": \"object\"}",
   "system_prompt_chars": 1300
  },
  {
   "name": "dream_archive",
   "agent": "dream",
   "mode": null,
   "model_slot": "dream_model",
   "model_key": "qwen-max",
   "model": "qwen3.8-max",
   "provider": "qwen",
   "params": {
    "temperature": 0.3,
    "max_tokens": 8192
   },
   "extra_body": {
    "enable_thinking": true
   },
   "max_turns": 30,
   "max_repairs": 1,
   "skills": [
    "wiki-format"
   ],
   "output_model": "ArchiveReport",
   "output_schema": {
    "properties": {
     "archived_msg_seqs": {
      "items": {
       "type": "integer"
      },
      "title": "Archived Msg Seqs",
      "type": "array"
     },
     "skipped_msg_seqs": {
      "items": {
       "type": "integer"
      },
      "title": "Skipped Msg Seqs",
      "type": "array"
     },
     "files_changed": {
      "items": {
       "type": "string"
      },
      "title": "Files Changed",
      "type": "array"
     },
     "notes": {
      "default": "",
      "title": "Notes",
      "type": "string"
     }
    },
    "title": "ArchiveReport",
    "type": "object"
   },
   "tools": [
    {
     "name": "hybrid_search",
     "description": "在用户的主题页和原话里多维混合检索（中文全文 + 型号模糊匹配 + 语义向量 + 正交维度/日期召回 + 重排），返回带锚点的结果。",
     "tags": [
      "db",
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "queries": {
        "description": "1~5 个检索词，可以是关键词、型号、上位概念或改写后的问法",
        "items": {
         "type": "string"
        },
        "maxItems": 5,
        "title": "Queries",
        "type": "array"
       },
       "facets": {
        "additionalProperties": {
         "items": {
          "type": "string"
         },
         "type": "array"
        },
        "description": "可选的多维标签过滤/加权，如 {'domain': ['学习'], 'form': ['网站']}",
        "title": "Facets",
        "type": "object"
       },
       "date_from": {
        "anyOf": [
         {
          "type": "string"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "description": "可选起始日期 YYYY-MM-DD",
        "title": "Date From"
       },
       "date_to": {
        "anyOf": [
         {
          "type": "string"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "description": "可选结束日期 YYYY-MM-DD",
        "title": "Date To"
       },
       "top_k": {
        "default": 6,
        "maximum": 12,
        "minimum": 1,
        "title": "Top K",
        "type": "integer"
       }
      },
      "type": "object"
     }
    },
    {
     "name": "fetch_raw_messages",
     "description": "按序号读取用户的逐字原话和时间，用来核验主题页里的结论。",
     "tags": [
      "db",
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "msg_seqs": {
        "description": "原话序号，即锚点 #msg_N 里的 N",
        "items": {
         "type": "integer"
        },
        "maxItems": 30,
        "minItems": 1,
        "title": "Msg Seqs",
        "type": "array"
       },
       "with_batch": {
        "default": true,
        "description": "是否带上同一连发批次的前后消息",
        "title": "With Batch",
        "type": "boolean"
       }
      },
      "required": [
       "msg_seqs"
      ],
      "type": "object"
     }
    },
    {
     "name": "list_dir",
     "description": "列出工作区下的文件和行数。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "default": ".",
        "description": "相对工作区的目录",
        "title": "Path",
        "type": "string"
       },
       "recursive": {
        "default": false,
        "description": "是否递归列出",
        "title": "Recursive",
        "type": "boolean"
       }
      },
      "type": "object"
     }
    },
    {
     "name": "read_file",
     "description": "读取工作区下的文件，输出带行号前缀（行号不是内容）。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "description": "相对工作区的文件路径",
        "title": "Path",
        "type": "string"
       },
       "start_line": {
        "default": 1,
        "minimum": 1,
        "title": "Start Line",
        "type": "integer"
       },
       "end_line": {
        "anyOf": [
         {
          "minimum": 1,
          "type": "integer"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "title": "End Line"
       }
      },
      "required": [
       "path"
      ],
      "type": "object"
     }
    },
    {
     "name": "bash",
     "description": "在断网的只读沙箱里执行 shell 命令，工作目录 /workspace，可见范围是工作区。适合 ls、rg、head、wc。",
     "tags": [
      "read",
      "shell"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "command": {
        "description": "只读 shell 命令，例如 ls -R、rg -n 关键词、head -n 50 文件",
        "title": "Command",
        "type": "string"
       }
      },
      "required": [
       "command"
      ],
      "type": "object"
     }
    },
    {
     "name": "write_file",
     "description": "整体写入工作区下的文件（不存在则新建）。",
     "tags": [
      "write"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "title": "Path",
        "type": "string"
       },
       "content": {
        "description": "文件完整新内容",
        "title": "Content",
        "type": "string"
       }
      },
      "required": [
       "path",
       "content"
      ],
      "type": "object"
     }
    },
    {
     "name": "edit_file",
     "description": "按原文精确替换工作区下文件的一段内容。",
     "tags": [
      "write"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "title": "Path",
        "type": "string"
       },
       "old_text": {
        "description": "要替换的原文，必须与文件内容逐字一致（不含行号前缀）",
        "title": "Old Text",
        "type": "string"
       },
       "new_text": {
        "title": "New Text",
        "type": "string"
       },
       "replace_all": {
        "default": false,
        "title": "Replace All",
        "type": "boolean"
       }
      },
      "required": [
       "path",
       "old_text",
       "new_text"
      ],
      "type": "object"
     }
    },
    {
     "name": "read_skill",
     "description": "读取一个技能的完整说明。",
     "tags": [
      "read"
     ],
     "max_output_chars": 20000,
     "parameters": {
      "properties": {
       "name": {
        "description": "技能名称",
        "title": "Name",
        "type": "string"
       }
      },
      "required": [
       "name"
      ],
      "type": "object"
     }
    }
   ],
   "system_prompt_raw": "你是用户个人记忆的整理者，在夜间离线运行。用户平时把零碎备忘随手发给自己，常常是半截话、缩写和只有本人懂的暗语。几个月后，用户可能从主题、载体形态、状态或时间任意维度凭模糊印象来问。你的工作是让那时的多维检索与拓扑图谱都能命中正确的原话。\n\n记忆分三处，都在工作区里：\n- wiki/：扁平命名的主题/实体/资源页，是带多维标签与有类型双向链接的导航图谱。\n- MEMORY_CACHE/：固定但不常用的背景（人物称呼、暗语、历史代号、低频偏好，以及 `facets.md` 用户扩展维度词）。\n- MEMORY.md：热区，本阶段你只读不写。\n\n本次任务：把待整理的原话归档进主题页。\n\n做法：\n1. 写之前先调用 read_skill 读 wiki-format，严格按里面的语法写。\n2. 按连发批次理解原话：同一批次的几条通常是一件事。结合热区记忆、已有主题页和必要的历史原话（fetch_raw_messages、hybrid_search）还原语境。\n3. 优先并入已有主题页（先 read_file 看原文，再 edit_file 或 write_file）；确实是新对象或新主题才新建页面。在 frontmatter 里填好 `type`、`aliases` 和页面公共维度 `facets`。\n4. **打好正交维度与事件日期（克制收敛，不造冗余词）**：\n   - 从受控维度词表里为页面（frontmatter `facets`）或单条事实（行内 `[dim:val]`）补齐正交视角。例如一条学习网站备忘，同时具备 `domain: 学习` 与 `form: 网站`，这样用户无论问“学习资料”还是“存过的网站”都能召回。\n   - frontmatter `facets` 只放整页恒定共有的 `domain`（1~2 个）和统一 `form`；瞬时状态 `status` 标在具体条目行内。`topic` 优先复用词表已有词，每页最多 1~2 个中观领域词，不要把已在 `aliases` 里的具体物品名/型号重复塞进 `topic`。\n   - 行内标签只描述该条事实本身，顺带提及的跨页关联对象用有类型链接（如 `[[belongs_to::xxx|显示名]]`、`[[uses::xxx]]`、`[[about::xxx]]`、`[[replaces::xxx]]`）表达，不要在 `[inferred]` 推测行上乱贴其他页面的 `domain`/`form`。\n   - 原话中出现具体日期或相对时间（如“下周六”“这周末”），根据原话方括号里的录入日期和星期换算成公历日期，标为 `[@YYYY-MM-DD]` 或 `[@YYYY-MM-DD..YYYY-MM-DD]`。\n5. 每条事实都带 [#msg_N] 锚点，区分 [confirmed] 和 [inferred]。拿不准就写 inferred，不要硬编。\n6. 状态变化（改时间、改价格、取消）要更新原条目与 `[status:...]` 标签，保留新旧锚点。\n7. 澄清消息（标注了“澄清”）是用户对追问的正式回答，是高优先级的已确认事实。暗语、称呼、缩写这类固定映射写进 MEMORY_CACHE/ 对应类别文件（必要时新建），同时把相关事实更新进主题页。\n8. 纯寒暄、测试、没有信息量的消息不必归档，放进 skipped_msg_seqs。\n9. 不要一条消息一个文件，不要写得比原话还长。\n\n最后汇报：archived_msg_seqs 是已写入记忆文件的原话序号，skipped_msg_seqs 是判断为无需归档的序号，files_changed 是改过的文件。\n",
   "system_prompt_final": "你是用户个人记忆的整理者，在夜间离线运行。用户平时把零碎备忘随手发给自己，常常是半截话、缩写和只有本人懂的暗语。几个月后，用户可能从主题、载体形态、状态或时间任意维度凭模糊印象来问。你的工作是让那时的多维检索与拓扑图谱都能命中正确的原话。\n\n记忆分三处，都在工作区里：\n- wiki/：扁平命名的主题/实体/资源页，是带多维标签与有类型双向链接的导航图谱。\n- MEMORY_CACHE/：固定但不常用的背景（人物称呼、暗语、历史代号、低频偏好，以及 `facets.md` 用户扩展维度词）。\n- MEMORY.md：热区，本阶段你只读不写。\n\n本次任务：把待整理的原话归档进主题页。\n\n做法：\n1. 写之前先调用 read_skill 读 wiki-format，严格按里面的语法写。\n2. 按连发批次理解原话：同一批次的几条通常是一件事。结合热区记忆、已有主题页和必要的历史原话（fetch_raw_messages、hybrid_search）还原语境。\n3. 优先并入已有主题页（先 read_file 看原文，再 edit_file 或 write_file）；确实是新对象或新主题才新建页面。在 frontmatter 里填好 `type`、`aliases` 和页面公共维度 `facets`。\n4. **打好正交维度与事件日期（克制收敛，不造冗余词）**：\n   - 从受控维度词表里为页面（frontmatter `facets`）或单条事实（行内 `[dim:val]`）补齐正交视角。例如一条学习网站备忘，同时具备 `domain: 学习` 与 `form: 网站`，这样用户无论问“学习资料”还是“存过的网站”都能召回。\n   - frontmatter `facets` 只放整页恒定共有的 `domain`（1~2 个）和统一 `form`；瞬时状态 `status` 标在具体条目行内。`topic` 优先复用词表已有词，每页最多 1~2 个中观领域词，不要把已在 `aliases` 里的具体物品名/型号重复塞进 `topic`。\n   - 行内标签只描述该条事实本身，顺带提及的跨页关联对象用有类型链接（如 `[[belongs_to::xxx|显示名]]`、`[[uses::xxx]]`、`[[about::xxx]]`、`[[replaces::xxx]]`）表达，不要在 `[inferred]` 推测行上乱贴其他页面的 `domain`/`form`。\n   - 原话中出现具体日期或相对时间（如“下周六”“这周末”），根据原话方括号里的录入日期和星期换算成公历日期，标为 `[@YYYY-MM-DD]` 或 `[@YYYY-MM-DD..YYYY-MM-DD]`。\n5. 每条事实都带 [#msg_N] 锚点，区分 [confirmed] 和 [inferred]。拿不准就写 inferred，不要硬编。\n6. 状态变化（改时间、改价格、取消）要更新原条目与 `[status:...]` 标签，保留新旧锚点。\n7. 澄清消息（标注了“澄清”）是用户对追问的正式回答，是高优先级的已确认事实。暗语、称呼、缩写这类固定映射写进 MEMORY_CACHE/ 对应类别文件（必要时新建），同时把相关事实更新进主题页。\n8. 纯寒暄、测试、没有信息量的消息不必归档，放进 skipped_msg_seqs。\n9. 不要一条消息一个文件，不要写得比原话还长。\n\n最后汇报：archived_msg_seqs 是已写入记忆文件的原话序号，skipped_msg_seqs 是判断为无需归档的序号，files_changed 是改过的文件。\n\n## 可用技能\n需要时先调用 read_skill 读取正文，再按正文执行。\n- wiki-format：主题页、多维标签、有类型双向链接、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"properties\": {\"archived_msg_seqs\": {\"items\": {\"type\": \"integer\"}, \"title\": \"Archived Msg Seqs\", \"type\": \"array\"}, \"skipped_msg_seqs\": {\"items\": {\"type\": \"integer\"}, \"title\": \"Skipped Msg Seqs\", \"type\": \"array\"}, \"files_changed\": {\"items\": {\"type\": \"string\"}, \"title\": \"Files Changed\", \"type\": \"array\"}, \"notes\": {\"default\": \"\", \"title\": \"Notes\", \"type\": \"string\"}}, \"title\": \"ArchiveReport\", \"type\": \"object\"}",
   "system_prompt_chars": 2152
  },
  {
   "name": "dream_tiering",
   "agent": "dream",
   "mode": "incremental",
   "model_slot": "dream_model",
   "model_key": "qwen-max",
   "model": "qwen3.8-max",
   "provider": "qwen",
   "params": {
    "temperature": 0.3,
    "max_tokens": 8192
   },
   "extra_body": {
    "enable_thinking": true
   },
   "max_turns": 30,
   "max_repairs": 1,
   "skills": [
    "wiki-format"
   ],
   "output_model": "TieringReport",
   "output_schema": {
    "$defs": {
     "TierMove": {
      "properties": {
       "entry_key": {
        "title": "Entry Key",
        "type": "string"
       },
       "file": {
        "default": "",
        "title": "File",
        "type": "string"
       }
      },
      "required": [
       "entry_key"
      ],
      "title": "TierMove",
      "type": "object"
     }
    },
    "properties": {
     "promotions": {
      "items": {
       "$ref": "#/$defs/TierMove"
      },
      "title": "Promotions",
      "type": "array"
     },
     "demotions": {
      "items": {
       "$ref": "#/$defs/TierMove"
      },
      "title": "Demotions",
      "type": "array"
     },
     "merged_pages": {
      "items": {
       "type": "string"
      },
      "title": "Merged Pages",
      "type": "array"
     },
     "fixed_links": {
      "default": 0,
      "title": "Fixed Links",
      "type": "integer"
     },
     "notes": {
      "default": "",
      "title": "Notes",
      "type": "string"
     }
    },
    "title": "TieringReport",
    "type": "object"
   },
   "tools": [
    {
     "name": "list_dir",
     "description": "列出工作区下的文件和行数。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "default": ".",
        "description": "相对工作区的目录",
        "title": "Path",
        "type": "string"
       },
       "recursive": {
        "default": false,
        "description": "是否递归列出",
        "title": "Recursive",
        "type": "boolean"
       }
      },
      "type": "object"
     }
    },
    {
     "name": "read_file",
     "description": "读取工作区下的文件，输出带行号前缀（行号不是内容）。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "description": "相对工作区的文件路径",
        "title": "Path",
        "type": "string"
       },
       "start_line": {
        "default": 1,
        "minimum": 1,
        "title": "Start Line",
        "type": "integer"
       },
       "end_line": {
        "anyOf": [
         {
          "minimum": 1,
          "type": "integer"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "title": "End Line"
       }
      },
      "required": [
       "path"
      ],
      "type": "object"
     }
    },
    {
     "name": "bash",
     "description": "在断网的只读沙箱里执行 shell 命令，工作目录 /workspace，可见范围是工作区。适合 ls、rg、head、wc。",
     "tags": [
      "read",
      "shell"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "command": {
        "description": "只读 shell 命令，例如 ls -R、rg -n 关键词、head -n 50 文件",
        "title": "Command",
        "type": "string"
       }
      },
      "required": [
       "command"
      ],
      "type": "object"
     }
    },
    {
     "name": "write_file",
     "description": "整体写入工作区下的文件（不存在则新建）。",
     "tags": [
      "write"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "title": "Path",
        "type": "string"
       },
       "content": {
        "description": "文件完整新内容",
        "title": "Content",
        "type": "string"
       }
      },
      "required": [
       "path",
       "content"
      ],
      "type": "object"
     }
    },
    {
     "name": "edit_file",
     "description": "按原文精确替换工作区下文件的一段内容。",
     "tags": [
      "write"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "title": "Path",
        "type": "string"
       },
       "old_text": {
        "description": "要替换的原文，必须与文件内容逐字一致（不含行号前缀）",
        "title": "Old Text",
        "type": "string"
       },
       "new_text": {
        "title": "New Text",
        "type": "string"
       },
       "replace_all": {
        "default": false,
        "title": "Replace All",
        "type": "boolean"
       }
      },
      "required": [
       "path",
       "old_text",
       "new_text"
      ],
      "type": "object"
     }
    },
    {
     "name": "read_skill",
     "description": "读取一个技能的完整说明。",
     "tags": [
      "read"
     ],
     "max_output_chars": 20000,
     "parameters": {
      "properties": {
       "name": {
        "description": "技能名称",
        "title": "Name",
        "type": "string"
       }
      },
      "required": [
       "name"
      ],
      "type": "object"
     }
    }
   ],
   "system_prompt_raw": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级与图谱重整。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：\n   - 合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）；\n   - 修复悬空链接（改成指向已有页面，或去掉链接括号），为明显上下位/依赖/涉及关系的普通链接补上关系前缀（如 `[[belongs_to::...]]`）；\n   - 检查维度分布里的近义/孤立维度值，统一回受控词表（用户高频专有细分词可沉淀到 `MEMORY_CACHE/facets.md`）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n",
   "system_prompt_final": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级与图谱重整。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：\n   - 合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）；\n   - 修复悬空链接（改成指向已有页面，或去掉链接括号），为明显上下位/依赖/涉及关系的普通链接补上关系前缀（如 `[[belongs_to::...]]`）；\n   - 检查维度分布里的近义/孤立维度值，统一回受控词表（用户高频专有细分词可沉淀到 `MEMORY_CACHE/facets.md`）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n\n## 可用技能\n需要时先调用 read_skill 读取正文，再按正文执行。\n- wiki-format：主题页、多维标签、有类型双向链接、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"$defs\": {\"TierMove\": {\"properties\": {\"entry_key\": {\"title\": \"Entry Key\", \"type\": \"string\"}, \"file\": {\"default\": \"\", \"title\": \"File\", \"type\": \"string\"}}, \"required\": [\"entry_key\"], \"title\": \"TierMove\", \"type\": \"object\"}}, \"properties\": {\"promotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Promotions\", \"type\": \"array\"}, \"demotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Demotions\", \"type\": \"array\"}, \"merged_pages\": {\"items\": {\"type\": \"string\"}, \"title\": \"Merged Pages\", \"type\": \"array\"}, \"fixed_links\": {\"default\": 0, \"title\": \"Fixed Links\", \"type\": \"integer\"}, \"notes\": {\"default\": \"\", \"title\": \"Notes\", \"type\": \"string\"}}, \"title\": \"TieringReport\", \"type\": \"object\"}",
   "system_prompt_chars": 1682
  },
  {
   "name": "dream_tiering_defrag",
   "agent": "dream",
   "mode": "defrag",
   "model_slot": "dream_model",
   "model_key": "qwen-max",
   "model": "qwen3.8-max",
   "provider": "qwen",
   "params": {
    "temperature": 0.3,
    "max_tokens": 8192
   },
   "extra_body": {
    "enable_thinking": true
   },
   "max_turns": 30,
   "max_repairs": 1,
   "skills": [
    "wiki-format"
   ],
   "output_model": "TieringReport",
   "output_schema": {
    "$defs": {
     "TierMove": {
      "properties": {
       "entry_key": {
        "title": "Entry Key",
        "type": "string"
       },
       "file": {
        "default": "",
        "title": "File",
        "type": "string"
       }
      },
      "required": [
       "entry_key"
      ],
      "title": "TierMove",
      "type": "object"
     }
    },
    "properties": {
     "promotions": {
      "items": {
       "$ref": "#/$defs/TierMove"
      },
      "title": "Promotions",
      "type": "array"
     },
     "demotions": {
      "items": {
       "$ref": "#/$defs/TierMove"
      },
      "title": "Demotions",
      "type": "array"
     },
     "merged_pages": {
      "items": {
       "type": "string"
      },
      "title": "Merged Pages",
      "type": "array"
     },
     "fixed_links": {
      "default": 0,
      "title": "Fixed Links",
      "type": "integer"
     },
     "notes": {
      "default": "",
      "title": "Notes",
      "type": "string"
     }
    },
    "title": "TieringReport",
    "type": "object"
   },
   "tools": [
    {
     "name": "list_dir",
     "description": "列出工作区下的文件和行数。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "default": ".",
        "description": "相对工作区的目录",
        "title": "Path",
        "type": "string"
       },
       "recursive": {
        "default": false,
        "description": "是否递归列出",
        "title": "Recursive",
        "type": "boolean"
       }
      },
      "type": "object"
     }
    },
    {
     "name": "read_file",
     "description": "读取工作区下的文件，输出带行号前缀（行号不是内容）。",
     "tags": [
      "read"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "description": "相对工作区的文件路径",
        "title": "Path",
        "type": "string"
       },
       "start_line": {
        "default": 1,
        "minimum": 1,
        "title": "Start Line",
        "type": "integer"
       },
       "end_line": {
        "anyOf": [
         {
          "minimum": 1,
          "type": "integer"
         },
         {
          "type": "null"
         }
        ],
        "default": null,
        "title": "End Line"
       }
      },
      "required": [
       "path"
      ],
      "type": "object"
     }
    },
    {
     "name": "bash",
     "description": "在断网的只读沙箱里执行 shell 命令，工作目录 /workspace，可见范围是工作区。适合 ls、rg、head、wc。",
     "tags": [
      "read",
      "shell"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "command": {
        "description": "只读 shell 命令，例如 ls -R、rg -n 关键词、head -n 50 文件",
        "title": "Command",
        "type": "string"
       }
      },
      "required": [
       "command"
      ],
      "type": "object"
     }
    },
    {
     "name": "write_file",
     "description": "整体写入工作区下的文件（不存在则新建）。",
     "tags": [
      "write"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "title": "Path",
        "type": "string"
       },
       "content": {
        "description": "文件完整新内容",
        "title": "Content",
        "type": "string"
       }
      },
      "required": [
       "path",
       "content"
      ],
      "type": "object"
     }
    },
    {
     "name": "edit_file",
     "description": "按原文精确替换工作区下文件的一段内容。",
     "tags": [
      "write"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "title": "Path",
        "type": "string"
       },
       "old_text": {
        "description": "要替换的原文，必须与文件内容逐字一致（不含行号前缀）",
        "title": "Old Text",
        "type": "string"
       },
       "new_text": {
        "title": "New Text",
        "type": "string"
       },
       "replace_all": {
        "default": false,
        "title": "Replace All",
        "type": "boolean"
       }
      },
      "required": [
       "path",
       "old_text",
       "new_text"
      ],
      "type": "object"
     }
    },
    {
     "name": "delete_file",
     "description": "删除工作区下的文件。",
     "tags": [
      "write"
     ],
     "max_output_chars": 8000,
     "parameters": {
      "properties": {
       "path": {
        "title": "Path",
        "type": "string"
       }
      },
      "required": [
       "path"
      ],
      "type": "object"
     }
    },
    {
     "name": "read_skill",
     "description": "读取一个技能的完整说明。",
     "tags": [
      "read"
     ],
     "max_output_chars": 20000,
     "parameters": {
      "properties": {
       "name": {
        "description": "技能名称",
        "title": "Name",
        "type": "string"
       }
      },
      "required": [
       "name"
      ],
      "type": "object"
     }
    }
   ],
   "system_prompt_raw": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级与图谱重整。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：\n   - 合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）；\n   - 修复悬空链接（改成指向已有页面，或去掉链接括号），为明显上下位/依赖/涉及关系的普通链接补上关系前缀（如 `[[belongs_to::...]]`）；\n   - 检查维度分布里的近义/孤立维度值，统一回受控词表（用户高频专有细分词可沉淀到 `MEMORY_CACHE/facets.md`）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n",
   "system_prompt_final": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级与图谱重整。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：\n   - 合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）；\n   - 修复悬空链接（改成指向已有页面，或去掉链接括号），为明显上下位/依赖/涉及关系的普通链接补上关系前缀（如 `[[belongs_to::...]]`）；\n   - 检查维度分布里的近义/孤立维度值，统一回受控词表（用户高频专有细分词可沉淀到 `MEMORY_CACHE/facets.md`）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n\n## 可用技能\n需要时先调用 read_skill 读取正文，再按正文执行。\n- wiki-format：主题页、多维标签、有类型双向链接、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"$defs\": {\"TierMove\": {\"properties\": {\"entry_key\": {\"title\": \"Entry Key\", \"type\": \"string\"}, \"file\": {\"default\": \"\", \"title\": \"File\", \"type\": \"string\"}}, \"required\": [\"entry_key\"], \"title\": \"TierMove\", \"type\": \"object\"}}, \"properties\": {\"promotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Promotions\", \"type\": \"array\"}, \"demotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Demotions\", \"type\": \"array\"}, \"merged_pages\": {\"items\": {\"type\": \"string\"}, \"title\": \"Merged Pages\", \"type\": \"array\"}, \"fixed_links\": {\"default\": 0, \"title\": \"Fixed Links\", \"type\": \"integer\"}, \"notes\": {\"default\": \"\", \"title\": \"Notes\", \"type\": \"string\"}}, \"title\": \"TieringReport\", \"type\": \"object\"}",
   "system_prompt_chars": 1682
  }
 ],
 "prompts": {
  "dream_archive": "你是用户个人记忆的整理者，在夜间离线运行。用户平时把零碎备忘随手发给自己，常常是半截话、缩写和只有本人懂的暗语。几个月后，用户可能从主题、载体形态、状态或时间任意维度凭模糊印象来问。你的工作是让那时的多维检索与拓扑图谱都能命中正确的原话。\n\n记忆分三处，都在工作区里：\n- wiki/：扁平命名的主题/实体/资源页，是带多维标签与有类型双向链接的导航图谱。\n- MEMORY_CACHE/：固定但不常用的背景（人物称呼、暗语、历史代号、低频偏好，以及 `facets.md` 用户扩展维度词）。\n- MEMORY.md：热区，本阶段你只读不写。\n\n本次任务：把待整理的原话归档进主题页。\n\n做法：\n1. 写之前先调用 read_skill 读 wiki-format，严格按里面的语法写。\n2. 按连发批次理解原话：同一批次的几条通常是一件事。结合热区记忆、已有主题页和必要的历史原话（fetch_raw_messages、hybrid_search）还原语境。\n3. 优先并入已有主题页（先 read_file 看原文，再 edit_file 或 write_file）；确实是新对象或新主题才新建页面。在 frontmatter 里填好 `type`、`aliases` 和页面公共维度 `facets`。\n4. **打好正交维度与事件日期（克制收敛，不造冗余词）**：\n   - 从受控维度词表里为页面（frontmatter `facets`）或单条事实（行内 `[dim:val]`）补齐正交视角。例如一条学习网站备忘，同时具备 `domain: 学习` 与 `form: 网站`，这样用户无论问“学习资料”还是“存过的网站”都能召回。\n   - frontmatter `facets` 只放整页恒定共有的 `domain`（1~2 个）和统一 `form`；瞬时状态 `status` 标在具体条目行内。`topic` 优先复用词表已有词，每页最多 1~2 个中观领域词，不要把已在 `aliases` 里的具体物品名/型号重复塞进 `topic`。\n   - 行内标签只描述该条事实本身，顺带提及的跨页关联对象用有类型链接（如 `[[belongs_to::xxx|显示名]]`、`[[uses::xxx]]`、`[[about::xxx]]`、`[[replaces::xxx]]`）表达，不要在 `[inferred]` 推测行上乱贴其他页面的 `domain`/`form`。\n   - 原话中出现具体日期或相对时间（如“下周六”“这周末”），根据原话方括号里的录入日期和星期换算成公历日期，标为 `[@YYYY-MM-DD]` 或 `[@YYYY-MM-DD..YYYY-MM-DD]`。\n5. 每条事实都带 [#msg_N] 锚点，区分 [confirmed] 和 [inferred]。拿不准就写 inferred，不要硬编。\n6. 状态变化（改时间、改价格、取消）要更新原条目与 `[status:...]` 标签，保留新旧锚点。\n7. 澄清消息（标注了“澄清”）是用户对追问的正式回答，是高优先级的已确认事实。暗语、称呼、缩写这类固定映射写进 MEMORY_CACHE/ 对应类别文件（必要时新建），同时把相关事实更新进主题页。\n8. 纯寒暄、测试、没有信息量的消息不必归档，放进 skipped_msg_seqs。\n9. 不要一条消息一个文件，不要写得比原话还长。\n\n最后汇报：archived_msg_seqs 是已写入记忆文件的原话序号，skipped_msg_seqs 是判断为无需归档的序号，files_changed 是改过的文件。\n",
  "dream_tiering": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级与图谱重整。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 {memory_limit} 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 {soft_limit} 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：\n   - 合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）；\n   - 修复悬空链接（改成指向已有页面，或去掉链接括号），为明显上下位/依赖/涉及关系的普通链接补上关系前缀（如 `[[belongs_to::...]]`）；\n   - 检查维度分布里的近义/孤立维度值，统一回受控词表（用户高频专有细分词可沉淀到 `MEMORY_CACHE/facets.md`）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n",
  "search_answer": "你是个人记忆检索的作答者。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你根据检索到的记录回答。\n\n你会收到：热区记忆、提问、补充线索、检索结果（主题页切片和原话），以及主题页锚点对应的逐字原话。\n\n规则：\n1. 原话是唯一事实依据。主题页是整理后的导航，结论要回到原话核对；主题页和原话冲突时以原话为准，并以较新的原话为准。\n2. 输入里已经附上了检索结果和对应原话，多数情况足够回答，这时不要调用工具，直接给最终输出。只有确实缺信息时，才调用 hybrid_search 换词再查、fetch_raw_messages 看更早的原话、read_file 读整篇主题页，最多一两次。\n3. 回答要直接、简短，给出用户要的那件事，带上时间等关键限定。被标为 inferred 的内容要说明是推测。\n4. verified_msg_seqs 只填你实际核对过、支撑答案的原话序号。hit_doc_paths 填用到的主题页路径。\n5. status：\n   - answered：找到了能回答问题的记录。\n   - ambiguous：找到多个候选，确实无法判断用户指哪一个。clarify_question 写一句简短的二选一或多选一追问。\n   - insufficient：没找到相关记录，或提问里有看不懂的暗语导致无法定位。把看不懂的词写进 unresolved_terms，clarify_question 写一句针对这个词的简短追问。\n6. 不要编造记录里没有的信息。\n7. 输入里“待确认的暗语”是路由看不懂的词。只有热区记忆、补充线索或原话里明确写出了这个词指什么，才能当作已知；不能凭常识、品牌联想或谐音去猜（例如把某个外号猜成某个品牌）。确认不了时 status 填 insufficient，把这个词写进 unresolved_terms。\n",
  "search_probe": "你在用户的候选缓存区 MEMORY_CACHE/ 里找线索。这里放着不常用但固定的背景：人物称呼、个人暗语和缩写、历史项目代号、低频偏好等，按类别分成多个 Markdown 文件，一行一个条目，键在前。\n\n主检索没能回答用户的问题，可能是因为提问里有看不懂的暗语或指代。你的任务是在缓存区里找到能解释它们的条目，并据此改写检索词。\n\n做法：\n1. 先用 bash 执行 `ls MEMORY_CACHE` 或 `rg -n 关键词 MEMORY_CACHE` 看有哪些文件、哪里提到了这些词。关键词可以试原词、去掉一个字的变体、拼音首字母等。\n2. 只读最相关的一两个文件，不要把所有文件都读一遍。\n3. 找到了：found=true，cache_hits 写命中的文件和条目键（键就是用户说出口的那个词），clues 写一句话解释，rewritten_queries 写改写后的 1~3 个检索词。\n4. 没找到：found=false，其他字段留空。不要猜。\n5. files_probed 写你实际读过或搜过的文件路径。\n",
  "search_router": "你是个人记忆检索的路由器。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你不回答问题，只为后续检索做准备。\n\n你会收到：当前日期（含星期）、可用维度词表、用户的热区记忆（MEMORY.md，已确认的个人背景和暗语）以及本次提问。\n\n要做的事：\n1. 结合热区记忆理解提问里的指代和暗语。用到了哪些热区条目，记在 memory_clues_used。\n2. 生成 1~4 个检索词（queries）：保留提问里的关键片段，补上热区解释后的真实名称、上位概念、同义说法、可能的型号或英文名。检索词要短，像搜索框里会输入的词。\n3. 抽取正交维度条件（facet_filters）：当提问明确指向某个主题域（如“学习资料”“工作记录” -> `{\"domain\": [\"学习\"]}`）、载体形态（如“存过的网站”“收藏的书”“买的外设” -> `{\"form\": [\"网站\"]}`）或状态（如“待办”“在用的” -> `{\"status\": [\"待办\"]}`）时，从可用维度词表里选出匹配的键值填入 facet_filters。没有明显维度倾向就留空 `{}`，不要硬猜。\n4. 抽取时间范围（date_from / date_to，格式 YYYY-MM-DD）：当提问包含明确日期或相对时间（如“上周”“这周六”“11月存的”），按输入里的“当前日期”换算成公历区间：\n   - 问事件发生/预约时间（如“这周六有什么安排”）时，`time_field` 填 `\"event\"`；\n   - 问记录/收藏时间（如“昨天记的那个”）时，`time_field` 填 `\"captured\"`；\n   - 分不清时填 `\"any\"`。没提时间则 date_from / date_to 都填 null。\n5. 提问里有你看不懂、热区也没解释的暗语、缩写或人名，写进 unknown_terms。看不懂不代表要追问，后面会先去候选缓存区查。\n6. 只有提问完全没有任何可检索的关键词、维度或时间（例如只有“帮我找一下”“那个呢”），才把 clarify_now 设为 true，并写一句简短追问。按类别/维度/时间提问（如“存过哪些网站”）一律设为 false。\n"
 },
 "skills": {
  "wiki-format": {
   "description": "主题页、多维标签、有类型双向链接、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。",
   "path": "code/percolation/skills/wiki-format/SKILL.md",
   "body": "# 记忆文件写法规范\n\n索引程序按下面的格式确定性解析文件，所有数据库检索索引与拓扑图谱都从 Markdown 派生。不按格式写会导致多维召回或图谱缺失。\n\n## 主题页 wiki/*.md\n\n- 文件名保持扁平，只用英文小写、数字和横线，例如 `wiki/learning-sites.md`、`wiki/home-study-desk.md`。文件名只是稳定标识，不要用多层子目录表达分类。\n- 文件开头必须有 frontmatter，包含 `title`、`type`、`aliases` 和页面级公共维度 `facets`：\n\n```yaml\n---\ntitle: 常用学习网站与课程收藏\ntype: resource\naliases: [网课, 自学网站, 教程收藏]\nfacets:\n  domain: [学习]\n  form: [网站]\n---\n```\n\n- `type` 从受控节点类型里选一个：`topic`（主题汇编，默认）、`entity`（物品/设备）、`person`（人物/宠物）、`project`（项目）、`resource`（网站/工具/资料）、`event`（日程/事件）。\n- `aliases` 写用户以后可能用来模糊提问的叫法：上位概念、同义词、口头叫法、英文名。3~8 个即可。\n- `facets` 写**整页恒定共有**的正交维度标签，维度键固定使用英文小写：\n  - `domain`（主题域）：工作、学习、生活、健康、财务、数码、家庭、出行、娱乐（每页 1~2 个）\n  - `form`（载体形态）：网站、工具软件、硬件外设、文档书籍、图片视频、账号凭据、线下地点、约定日程（仅当整页载体统一时写在 frontmatter，否则写在具体条目行内）\n  - `status`（状态）：想法、待办、进行中、待购、在用、已完成、已放弃（**瞬时状态尽量标在具体条目行内**，不要给人物/宠物等长期档案页的 frontmatter 挂整页 `status`）\n  - `topic`（细分话题）：限中观领域（每页最多 1~2 个，如 `命令行`、`宠物医疗`），优先复用词表已有词；**禁止把已在 `aliases` 里的具体商品名、型号、房间部件重复塞进 `topic`**\n- 正文用 `## 小节` 分段，每个小节是一个独立的切片检索单元（小节级维度不会跨小节串扰）。小节内用列表，一条一个事实。\n- 每条事实开头标确定性，结尾带原话锚点，中间可加**行内维度**与**事件日期**：\n  - `- [confirmed] MIT Missing Semester 课程主页，周末刷前两讲 [form:网站] [topic:命令行] [status:进行中] [@2026-11-15] [#msg_42]`\n  - `- [confirmed] CFORCE 15.6 寸 OLED 便携屏，目标价 999 元 [form:硬件外设] [status:待购] [#msg_12]`\n  - `- [inferred] 可能配合 [[belongs_to::home-study-desk|书房改造]] 使用 [#msg_13] [#msg_15]`\n- 行内标签规则：\n  - 页面 frontmatter 里的 `facets` 会自动继承给页内所有带 `[#msg_N]` 的条目，行内只需补充该条目特有的维度（例如同一页既有网站又有书籍时，在行内标 `[form:网站]`、`[form:文档书籍]`）。\n  - **行内 `[dim:val]` 只描述本条核心事实本身**：顺带提及的关联对象用 `[[uses::...]]` / `[[about::...]]` 链接表达即可，不要在 `[inferred]` 顺带推测行上贴其他领域的 `domain`/`form` 标签。\n  - 原话里提到具体日期或相对时间（如“下周六”“下个月初”），按原话录入日期换算成公历，标为 `[@YYYY-MM-DD]` 或区间 `[@YYYY-MM-DD..YYYY-MM-DD]`。没有事件时间就不标。\n  - 用户原话直接说明的写 `[confirmed]`；靠上下文推断的写 `[inferred]`。\n- 关联页面用有类型双向链接：`[[rel::target|显示文本]]` 或 `[[rel::target]]`，例如：\n  - `[[belongs_to::cs-self-study|计算机自学]]`（属于/上下位）\n  - `[[part_of::home-study-desk|书房桌面的一部分]]`（组成部分）\n  - `[[uses::anki-workflow]]`（使用/依赖）\n  - `[[replaces::old-monitor]]`（替代）\n  - `[[about::person-laozhang|老张]]`（涉及人物/项目）\n  - 一般关联可直接写 `[[home-study-desk]]`（等同于 `related`）。链接目标写文件名（不带 `wiki/` 和 `.md`）。\n- 状态变化时改写原条目并保留新旧锚点（如 `[status:待购]` 改为 `[status:在用]`），不要只追加一条矛盾的新条目。\n- 新信息优先并入已有页面，同时用 `facets` 和行内 `[dim:val]` 标出不同维度视角，方便从主题、形态、状态、时间任意维度检索。不要写得比原话还长。\n\n## 候选缓存区 MEMORY_CACHE/*.md\n\n- 存固定但不常用的背景：人物称呼映射、个人暗语和缩写、历史项目代号、账号与环境参数、低频偏好。\n- 按类别分文件，文件名英文，例如 `MEMORY_CACHE/people.md`、`MEMORY_CACHE/slang.md`。\n- 用户特有的高频自定义维度词（如特定专业或业务线）可记在 `MEMORY_CACHE/facets.md`，格式：`- topic: 强化学习, 编译器`。\n- 普通缓存文件一行一个条目，键在前：`- 老张：供应商张伟，负责显示器报价 [confirmed] [#msg_8]`。\n\n## 热区 MEMORY.md\n\n- 每次检索都会注入，硬上限 200 行。只放已确认、经常用到的核心背景和高频暗语。\n- 禁止出现 `[inferred]` 条目。\n- 格式与缓存区相同：`- 键：解释 [#msg_N]`，按类别用 `## 小节` 分组。"
  }
 },
 "models": {
  "slots": {
   "router_model": "qwen-flash",
   "search_model": "qwen-flash",
   "dream_model": "qwen-max",
   "embedding_model": "embedding-v4",
   "rerank_model": "gte-rerank-v2"
  },
  "models": [
   {
    "key": "qwen-flash",
    "label": "通义千问 Flash",
    "provider": "qwen",
    "protocol": "openai",
    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "qwen3.8-flash",
    "params": {
     "temperature": 0.3,
     "max_tokens": 4096
    },
    "extra_body": {
     "enable_thinking": false
    },
    "pricing": {
     "currency": "CNY",
     "input": 0.8,
     "cached_input": 0.1,
     "output": 2.7,
     "unit": "per_1m_tokens",
     "source": "百炼北京地域刊例价 2026-11"
    }
   },
   {
    "key": "qwen-max",
    "label": "通义千问 Max",
    "provider": "qwen",
    "protocol": "openai",
    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "qwen3.8-max",
    "params": {
     "temperature": 0.3,
     "max_tokens": 8192
    },
    "extra_body": {
     "enable_thinking": true
    },
    "pricing": {
     "currency": "CNY",
     "input": 12,
     "cached_input": 1.5,
     "output": 36,
     "unit": "per_1m_tokens",
     "source": "百炼北京地域刊例价 2026-11"
    }
   },
   {
    "key": "doubao-turbo",
    "label": "豆包 Seed Turbo",
    "provider": "doubao",
    "protocol": "openai",
    "base_url": "https://ark.cn-beijing.volces.com/api/v3",
    "model": "doubao-seed-2-1-turbo-260628",
    "params": {
     "max_tokens": 4096
    },
    "extra_body": {
     "thinking": {
      "type": "disabled"
     }
    }
   },
   {
    "key": "doubao-pro",
    "label": "豆包 Seed Pro",
    "provider": "doubao",
    "protocol": "openai",
    "base_url": "https://ark.cn-beijing.volces.com/api/v3",
    "model": "doubao-seed-2-1-pro-260915",
    "params": {
     "max_tokens": 8192
    },
    "extra_body": {
     "reasoning_effort": "medium"
    }
   },
   {
    "key": "embedding-v4",
    "label": "通义 text-embedding-v4",
    "provider": "qwen",
    "protocol": "openai-embedding",
    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "model": "text-embedding-v4",
    "dimensions": 1024,
    "pricing": {
     "currency": "CNY",
     "input": 0.5,
     "unit": "per_1m_tokens",
     "source": "百炼北京地域刊例价 2026-11"
    }
   },
   {
    "key": "gte-rerank-v2",
    "label": "通义 gte-rerank-v2",
    "provider": "qwen",
    "protocol": "dashscope-rerank",
    "base_url": "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
    "model": "gte-rerank-v2",
    "pricing": {
     "currency": "CNY",
     "input": 0.8,
     "unit": "per_1m_tokens",
     "source": "百炼北京地域刊例价 2026-11"
    }
   }
  ]
 },
 "constants": {
  "memory_line_limit": 200,
  "memory_soft_limit": 180,
  "promotion_window_days": 14,
  "promotion_min_hits": 2,
  "defrag_interval_days": 7,
  "defrag_dangling_links": 5,
  "archive_batch_messages": 40
 }
};
