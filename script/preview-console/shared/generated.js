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
   "system_prompt_raw": "你是个人记忆检索的路由器。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你不回答问题，只为后续检索做准备。\n\n你会收到用户的热区记忆（MEMORY.md，里面是已确认的个人背景和暗语）和本次提问。\n\n要做的事：\n1. 结合热区记忆理解提问里的指代和暗语。用到了哪些热区条目，记在 memory_clues_used。\n2. 生成 1~4 个检索词：保留提问里的关键片段，补上热区解释后的真实名称、上位概念、同义说法、可能的型号或英文名。检索词要短，像搜索框里会输入的词。\n3. 提问里有你看不懂、热区也没解释的暗语、缩写或人名，写进 unknown_terms。看不懂不代表要追问，后面会先去候选缓存区查。\n4. 只有提问完全没有可检索的内容（例如只有“帮我找一下”“那个呢”），才把 clarify_now 设为 true，并写一句简短追问。其他情况一律 false。\n",
   "system_prompt_final": "你是个人记忆检索的路由器。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你不回答问题，只为后续检索做准备。\n\n你会收到用户的热区记忆（MEMORY.md，里面是已确认的个人背景和暗语）和本次提问。\n\n要做的事：\n1. 结合热区记忆理解提问里的指代和暗语。用到了哪些热区条目，记在 memory_clues_used。\n2. 生成 1~4 个检索词：保留提问里的关键片段，补上热区解释后的真实名称、上位概念、同义说法、可能的型号或英文名。检索词要短，像搜索框里会输入的词。\n3. 提问里有你看不懂、热区也没解释的暗语、缩写或人名，写进 unknown_terms。看不懂不代表要追问，后面会先去候选缓存区查。\n4. 只有提问完全没有可检索的内容（例如只有“帮我找一下”“那个呢”），才把 clarify_now 设为 true，并写一句简短追问。其他情况一律 false。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"properties\": {\"queries\": {\"description\": \"1~4 个检索词\", \"items\": {\"type\": \"string\"}, \"title\": \"Queries\", \"type\": \"array\"}, \"unknown_terms\": {\"description\": \"看不懂、热区也没解释的暗语或指代\", \"items\": {\"type\": \"string\"}, \"title\": \"Unknown Terms\", \"type\": \"array\"}, \"memory_clues_used\": {\"description\": \"用到的热区条目键\", \"items\": {\"type\": \"string\"}, \"title\": \"Memory Clues Used\", \"type\": \"array\"}, \"clarify_now\": {\"default\": false, \"title\": \"Clarify Now\", \"type\": \"boolean\"}, \"clarify_question\": {\"default\": \"\", \"title\": \"Clarify Question\", \"type\": \"string\"}}, \"title\": \"RoutePlan\", \"type\": \"object\"}",
   "system_prompt_chars": 1040
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
     "description": "在用户的主题页和原话里混合检索（中文全文 + 型号模糊匹配 + 语义向量 + 重排），返回带锚点的结果。",
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
        "minItems": 1,
        "title": "Queries",
        "type": "array"
       },
       "top_k": {
        "default": 6,
        "maximum": 12,
        "minimum": 1,
        "title": "Top K",
        "type": "integer"
       }
      },
      "required": [
       "queries"
      ],
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
   "system_prompt_raw": "你是个人记忆检索的作答者。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你根据检索到的记录回答。\n\n你会收到：热区记忆、提问、补充线索、检索结果（主题页切片和原话），以及主题页锚点对应的逐字原话。\n\n规则：\n1. 原话是唯一事实依据。主题页是整理后的导航，结论要回到原话核对；主题页和原话冲突时以原话为准，并以较新的原话为准。\n2. 输入里已经附上了检索结果和对应原话，多数情况足够回答，这时不要调用工具，直接给最终输出。只有确实缺信息时，才调用 hybrid_search 换词再查、fetch_raw_messages 看更早的原话、read_file 读整篇主题页，最多一两次。\n3. 回答要直接、简短，给出用户要的那件事，带上时间等关键限定。被标为 inferred 的内容要说明是推测。\n4. verified_msg_seqs 只填你实际核对过、支撑答案的原话序号。hit_doc_paths 填用到的主题页路径。\n5. status：\n   - answered：找到了能回答问题的记录。\n   - ambiguous：找到多个候选，确实无法判断用户指哪一个。clarify_question 写一句简短的二选一或多选一追问。\n   - insufficient：没找到相关记录，或提问里有看不懂的暗语导致无法定位。把看不懂的词写进 unresolved_terms，clarify_question 写一句针对这个词的简短追问。\n6. 不要编造记录里没有的信息。\n",
   "system_prompt_final": "你是个人记忆检索的作答者。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你根据检索到的记录回答。\n\n你会收到：热区记忆、提问、补充线索、检索结果（主题页切片和原话），以及主题页锚点对应的逐字原话。\n\n规则：\n1. 原话是唯一事实依据。主题页是整理后的导航，结论要回到原话核对；主题页和原话冲突时以原话为准，并以较新的原话为准。\n2. 输入里已经附上了检索结果和对应原话，多数情况足够回答，这时不要调用工具，直接给最终输出。只有确实缺信息时，才调用 hybrid_search 换词再查、fetch_raw_messages 看更早的原话、read_file 读整篇主题页，最多一两次。\n3. 回答要直接、简短，给出用户要的那件事，带上时间等关键限定。被标为 inferred 的内容要说明是推测。\n4. verified_msg_seqs 只填你实际核对过、支撑答案的原话序号。hit_doc_paths 填用到的主题页路径。\n5. status：\n   - answered：找到了能回答问题的记录。\n   - ambiguous：找到多个候选，确实无法判断用户指哪一个。clarify_question 写一句简短的二选一或多选一追问。\n   - insufficient：没找到相关记录，或提问里有看不懂的暗语导致无法定位。把看不懂的词写进 unresolved_terms，clarify_question 写一句针对这个词的简短追问。\n6. 不要编造记录里没有的信息。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"properties\": {\"status\": {\"enum\": [\"answered\", \"ambiguous\", \"insufficient\"], \"title\": \"Status\", \"type\": \"string\"}, \"answer\": {\"default\": \"\", \"title\": \"Answer\", \"type\": \"string\"}, \"verified_msg_seqs\": {\"items\": {\"type\": \"integer\"}, \"title\": \"Verified Msg Seqs\", \"type\": \"array\"}, \"hit_doc_paths\": {\"items\": {\"type\": \"string\"}, \"title\": \"Hit Doc Paths\", \"type\": \"array\"}, \"unresolved_terms\": {\"items\": {\"type\": \"string\"}, \"title\": \"Unresolved Terms\", \"type\": \"array\"}, \"clarify_question\": {\"default\": \"\", \"title\": \"Clarify Question\", \"type\": \"string\"}}, \"required\": [\"status\"], \"title\": \"AnswerDraft\", \"type\": \"object\"}",
   "system_prompt_chars": 1336
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
     "description": "在用户的主题页和原话里混合检索（中文全文 + 型号模糊匹配 + 语义向量 + 重排），返回带锚点的结果。",
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
        "minItems": 1,
        "title": "Queries",
        "type": "array"
       },
       "top_k": {
        "default": 6,
        "maximum": 12,
        "minimum": 1,
        "title": "Top K",
        "type": "integer"
       }
      },
      "required": [
       "queries"
      ],
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
   "system_prompt_raw": "你是用户个人记忆的整理者，在夜间离线运行。用户平时把零碎备忘随手发给自己，常常是半截话、缩写和只有本人懂的暗语。几个月后，用户会凭模糊印象来问。你的工作是让那时的检索能找到正确的原话。\n\n记忆分三处，都在工作区里：\n- wiki/：按主题聚合的主题页，是检索的导航地图。\n- MEMORY_CACHE/：固定但不常用的背景（人物称呼、暗语、历史代号、低频偏好）。\n- MEMORY.md：热区，本阶段你只读不写。\n\n本次任务：把待整理的原话归档进主题页。\n\n做法：\n1. 写之前先调用 read_skill 读 wiki-format，按里面的格式写。\n2. 按连发批次理解原话：同一批次的几条通常是一件事。结合热区记忆、已有主题页和必要的历史原话（fetch_raw_messages、hybrid_search）还原语境。\n3. 优先并入已有主题页（先 read_file 看原文，再 edit_file 或 write_file）；确实是新主题才新建页面。在 aliases 里补上用户以后可能用来提问的上位概念和同义叫法。\n4. 每条事实都带 [#msg_N] 锚点，区分 [confirmed] 和 [inferred]。拿不准就写 inferred，不要硬编。\n5. 状态变化（改时间、改价格、取消）要更新原条目，保留新旧锚点。\n6. 澄清消息（标注了“澄清”）是用户对追问的正式回答，是高优先级的已确认事实。暗语、称呼、缩写这类固定映射写进 MEMORY_CACHE/ 对应类别文件（必要时新建），同时把相关事实更新进主题页。\n7. 纯寒暄、测试、没有信息量的消息不必归档，放进 skipped_msg_seqs。\n8. 不要一条消息一个文件，不要写得比原话还长。\n\n最后汇报：archived_msg_seqs 是已写入记忆文件的原话序号，skipped_msg_seqs 是判断为无需归档的序号，files_changed 是改过的文件。\n",
   "system_prompt_final": "你是用户个人记忆的整理者，在夜间离线运行。用户平时把零碎备忘随手发给自己，常常是半截话、缩写和只有本人懂的暗语。几个月后，用户会凭模糊印象来问。你的工作是让那时的检索能找到正确的原话。\n\n记忆分三处，都在工作区里：\n- wiki/：按主题聚合的主题页，是检索的导航地图。\n- MEMORY_CACHE/：固定但不常用的背景（人物称呼、暗语、历史代号、低频偏好）。\n- MEMORY.md：热区，本阶段你只读不写。\n\n本次任务：把待整理的原话归档进主题页。\n\n做法：\n1. 写之前先调用 read_skill 读 wiki-format，按里面的格式写。\n2. 按连发批次理解原话：同一批次的几条通常是一件事。结合热区记忆、已有主题页和必要的历史原话（fetch_raw_messages、hybrid_search）还原语境。\n3. 优先并入已有主题页（先 read_file 看原文，再 edit_file 或 write_file）；确实是新主题才新建页面。在 aliases 里补上用户以后可能用来提问的上位概念和同义叫法。\n4. 每条事实都带 [#msg_N] 锚点，区分 [confirmed] 和 [inferred]。拿不准就写 inferred，不要硬编。\n5. 状态变化（改时间、改价格、取消）要更新原条目，保留新旧锚点。\n6. 澄清消息（标注了“澄清”）是用户对追问的正式回答，是高优先级的已确认事实。暗语、称呼、缩写这类固定映射写进 MEMORY_CACHE/ 对应类别文件（必要时新建），同时把相关事实更新进主题页。\n7. 纯寒暄、测试、没有信息量的消息不必归档，放进 skipped_msg_seqs。\n8. 不要一条消息一个文件，不要写得比原话还长。\n\n最后汇报：archived_msg_seqs 是已写入记忆文件的原话序号，skipped_msg_seqs 是判断为无需归档的序号，files_changed 是改过的文件。\n\n## 可用技能\n需要时先调用 read_skill 读取正文，再按正文执行。\n- wiki-format：主题页、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"properties\": {\"archived_msg_seqs\": {\"items\": {\"type\": \"integer\"}, \"title\": \"Archived Msg Seqs\", \"type\": \"array\"}, \"skipped_msg_seqs\": {\"items\": {\"type\": \"integer\"}, \"title\": \"Skipped Msg Seqs\", \"type\": \"array\"}, \"files_changed\": {\"items\": {\"type\": \"string\"}, \"title\": \"Files Changed\", \"type\": \"array\"}, \"notes\": {\"default\": \"\", \"title\": \"Notes\", \"type\": \"string\"}}, \"title\": \"ArchiveReport\", \"type\": \"object\"}",
   "system_prompt_chars": 1429
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
   "system_prompt_raw": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）、修复悬空链接（改成指向已有页面，或去掉链接括号）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n",
   "system_prompt_final": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）、修复悬空链接（改成指向已有页面，或去掉链接括号）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n\n## 可用技能\n需要时先调用 read_skill 读取正文，再按正文执行。\n- wiki-format：主题页、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"$defs\": {\"TierMove\": {\"properties\": {\"entry_key\": {\"title\": \"Entry Key\", \"type\": \"string\"}, \"file\": {\"default\": \"\", \"title\": \"File\", \"type\": \"string\"}}, \"required\": [\"entry_key\"], \"title\": \"TierMove\", \"type\": \"object\"}}, \"properties\": {\"promotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Promotions\", \"type\": \"array\"}, \"demotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Demotions\", \"type\": \"array\"}, \"merged_pages\": {\"items\": {\"type\": \"string\"}, \"title\": \"Merged Pages\", \"type\": \"array\"}, \"fixed_links\": {\"default\": 0, \"title\": \"Fixed Links\", \"type\": \"integer\"}, \"notes\": {\"default\": \"\", \"title\": \"Notes\", \"type\": \"string\"}}, \"title\": \"TieringReport\", \"type\": \"object\"}",
   "system_prompt_chars": 1530
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
   "system_prompt_raw": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）、修复悬空链接（改成指向已有页面，或去掉链接括号）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n",
   "system_prompt_final": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 200 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 180 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）、修复悬空链接（改成指向已有页面，或去掉链接括号）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n\n## 可用技能\n需要时先调用 read_skill 读取正文，再按正文执行。\n- wiki-format：主题页、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。\n\n## 最终输出\n完成后不要再调用工具。最终回复只包含一个 JSON 对象，字段符合下面的 JSON Schema，不要加解释或 Markdown：\n{\"$defs\": {\"TierMove\": {\"properties\": {\"entry_key\": {\"title\": \"Entry Key\", \"type\": \"string\"}, \"file\": {\"default\": \"\", \"title\": \"File\", \"type\": \"string\"}}, \"required\": [\"entry_key\"], \"title\": \"TierMove\", \"type\": \"object\"}}, \"properties\": {\"promotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Promotions\", \"type\": \"array\"}, \"demotions\": {\"items\": {\"$ref\": \"#/$defs/TierMove\"}, \"title\": \"Demotions\", \"type\": \"array\"}, \"merged_pages\": {\"items\": {\"type\": \"string\"}, \"title\": \"Merged Pages\", \"type\": \"array\"}, \"fixed_links\": {\"default\": 0, \"title\": \"Fixed Links\", \"type\": \"integer\"}, \"notes\": {\"default\": \"\", \"title\": \"Notes\", \"type\": \"string\"}}, \"title\": \"TieringReport\", \"type\": \"object\"}",
   "system_prompt_chars": 1530
  }
 ],
 "prompts": {
  "dream_archive": "你是用户个人记忆的整理者，在夜间离线运行。用户平时把零碎备忘随手发给自己，常常是半截话、缩写和只有本人懂的暗语。几个月后，用户会凭模糊印象来问。你的工作是让那时的检索能找到正确的原话。\n\n记忆分三处，都在工作区里：\n- wiki/：按主题聚合的主题页，是检索的导航地图。\n- MEMORY_CACHE/：固定但不常用的背景（人物称呼、暗语、历史代号、低频偏好）。\n- MEMORY.md：热区，本阶段你只读不写。\n\n本次任务：把待整理的原话归档进主题页。\n\n做法：\n1. 写之前先调用 read_skill 读 wiki-format，按里面的格式写。\n2. 按连发批次理解原话：同一批次的几条通常是一件事。结合热区记忆、已有主题页和必要的历史原话（fetch_raw_messages、hybrid_search）还原语境。\n3. 优先并入已有主题页（先 read_file 看原文，再 edit_file 或 write_file）；确实是新主题才新建页面。在 aliases 里补上用户以后可能用来提问的上位概念和同义叫法。\n4. 每条事实都带 [#msg_N] 锚点，区分 [confirmed] 和 [inferred]。拿不准就写 inferred，不要硬编。\n5. 状态变化（改时间、改价格、取消）要更新原条目，保留新旧锚点。\n6. 澄清消息（标注了“澄清”）是用户对追问的正式回答，是高优先级的已确认事实。暗语、称呼、缩写这类固定映射写进 MEMORY_CACHE/ 对应类别文件（必要时新建），同时把相关事实更新进主题页。\n7. 纯寒暄、测试、没有信息量的消息不必归档，放进 skipped_msg_seqs。\n8. 不要一条消息一个文件，不要写得比原话还长。\n\n最后汇报：archived_msg_seqs 是已写入记忆文件的原话序号，skipped_msg_seqs 是判断为无需归档的序号，files_changed 是改过的文件。\n",
  "dream_tiering": "你是用户个人记忆的整理者，在夜间离线运行。这一步负责记忆分层的升降级。\n\n- MEMORY.md 是热区：每次检索都会注入，帮助理解用户的暗语和背景。硬上限 {memory_limit} 行，只放已确认、经常用到的条目，禁止 [inferred]。\n- MEMORY_CACHE/ 是候选区：固定但不常用的条目，检索主路径失败时才会被翻查。\n\n你会收到：热区当前内容、近期候选区命中统计（哪些条目在检索时被翻出来帮了忙）、热区条目的使用统计、本次模式。\n\n规则：\n1. 晋升：命中统计里标为“建议晋升”的条目，如果在候选区里是 [confirmed]，就把它移进 MEMORY.md 对应小节（从候选区文件里删掉该行，写进热区）。[inferred] 条目不能晋升。\n2. 下沉：热区超过 {soft_limit} 行，或处于 defrag 模式时，把长期没用到、又不属于核心身份背景的条目移回 MEMORY_CACHE/ 对应类别文件。\n3. defrag 模式还要做：合并内容重复的主题页（把内容并入一页，删掉另一页，并修正指向它的链接）、修复悬空链接（改成指向已有页面，或去掉链接括号）。\n4. 没有需要改的就什么都不改，直接汇报空结果。不要为了改而改。\n5. 写之前先调用 read_skill 读 wiki-format。改文件前先 read_file 看原文。\n\n汇报：promotions 和 demotions 写条目键和文件，merged_pages 写被合并删除的页面，fixed_links 写修复的链接数。\n",
  "search_answer": "你是个人记忆检索的作答者。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你根据检索到的记录回答。\n\n你会收到：热区记忆、提问、补充线索、检索结果（主题页切片和原话），以及主题页锚点对应的逐字原话。\n\n规则：\n1. 原话是唯一事实依据。主题页是整理后的导航，结论要回到原话核对；主题页和原话冲突时以原话为准，并以较新的原话为准。\n2. 输入里已经附上了检索结果和对应原话，多数情况足够回答，这时不要调用工具，直接给最终输出。只有确实缺信息时，才调用 hybrid_search 换词再查、fetch_raw_messages 看更早的原话、read_file 读整篇主题页，最多一两次。\n3. 回答要直接、简短，给出用户要的那件事，带上时间等关键限定。被标为 inferred 的内容要说明是推测。\n4. verified_msg_seqs 只填你实际核对过、支撑答案的原话序号。hit_doc_paths 填用到的主题页路径。\n5. status：\n   - answered：找到了能回答问题的记录。\n   - ambiguous：找到多个候选，确实无法判断用户指哪一个。clarify_question 写一句简短的二选一或多选一追问。\n   - insufficient：没找到相关记录，或提问里有看不懂的暗语导致无法定位。把看不懂的词写进 unresolved_terms，clarify_question 写一句针对这个词的简短追问。\n6. 不要编造记录里没有的信息。\n",
  "search_probe": "你在用户的候选缓存区 MEMORY_CACHE/ 里找线索。这里放着不常用但固定的背景：人物称呼、个人暗语和缩写、历史项目代号、低频偏好等，按类别分成多个 Markdown 文件，一行一个条目，键在前。\n\n主检索没能回答用户的问题，可能是因为提问里有看不懂的暗语或指代。你的任务是在缓存区里找到能解释它们的条目，并据此改写检索词。\n\n做法：\n1. 先用 bash 执行 `ls MEMORY_CACHE` 或 `rg -n 关键词 MEMORY_CACHE` 看有哪些文件、哪里提到了这些词。关键词可以试原词、去掉一个字的变体、拼音首字母等。\n2. 只读最相关的一两个文件，不要把所有文件都读一遍。\n3. 找到了：found=true，cache_hits 写命中的文件和条目键（键就是用户说出口的那个词），clues 写一句话解释，rewritten_queries 写改写后的 1~3 个检索词。\n4. 没找到：found=false，其他字段留空。不要猜。\n5. files_probed 写你实际读过或搜过的文件路径。\n",
  "search_router": "你是个人记忆检索的路由器。用户平时把零碎备忘随手发给自己，现在凭模糊印象来问。你不回答问题，只为后续检索做准备。\n\n你会收到用户的热区记忆（MEMORY.md，里面是已确认的个人背景和暗语）和本次提问。\n\n要做的事：\n1. 结合热区记忆理解提问里的指代和暗语。用到了哪些热区条目，记在 memory_clues_used。\n2. 生成 1~4 个检索词：保留提问里的关键片段，补上热区解释后的真实名称、上位概念、同义说法、可能的型号或英文名。检索词要短，像搜索框里会输入的词。\n3. 提问里有你看不懂、热区也没解释的暗语、缩写或人名，写进 unknown_terms。看不懂不代表要追问，后面会先去候选缓存区查。\n4. 只有提问完全没有可检索的内容（例如只有“帮我找一下”“那个呢”），才把 clarify_now 设为 true，并写一句简短追问。其他情况一律 false。\n"
 },
 "skills": {
  "wiki-format": {
   "description": "主题页、候选缓存区和热区文件的写法规范。写或改 wiki/、MEMORY_CACHE/、MEMORY.md 之前必读。",
   "path": "code/percolation/skills/wiki-format/SKILL.md",
   "body": "# 记忆文件写法规范\n\n索引程序按下面的格式解析文件，不按格式写会导致检索不到。\n\n## 主题页 wiki/*.md\n\n- 文件名只用英文小写、数字和横线，例如 `wiki/digital-gear.md`、`wiki/home-study-desk.md`。中文写在 title 里。\n- 文件开头必须有 frontmatter：\n\n```\n---\ntitle: 数码外设与待购清单\naliases: [便携显示器, 外接副屏, 桌面支架]\n---\n```\n\n- aliases 写用户以后可能用来模糊提问的叫法：上位概念、同义词、口头叫法、英文名。3~8 个即可。\n- 正文用 `## 小节` 分段，每个小节是一个检索单元。小节内用列表，一条一个事实。\n- 每条事实开头标确定性，结尾带原话锚点：\n  - `- [confirmed] CFORCE 15.6 寸 OLED 便携屏，目标价 999 元 [#msg_12]`\n  - `- [inferred] 可能想配合书房桌面改造使用 [#msg_13]`\n  - 用户原话直接说明的写 confirmed；靠上下文推断的写 inferred。不确定就写 inferred。\n  - 一条事实可以有多个锚点：`[#msg_12] [#msg_15]`。\n- 关联页面用双向链接：`[[home-study-desk]]` 或 `[[home-study-desk|书房改造]]`。链接目标写文件名（不带 wiki/ 和 .md）。\n- 状态变化时改写原条目并保留新旧锚点，例如“约会改到周四下午（原定周二）[#msg_20] [#msg_31]”，不要只追加一条矛盾的新条目。\n- 一个主题一页，围绕长期主题聚合，不要一条消息一个文件。新信息优先并入已有页面。\n- 不要写得比原话还长。主题页是导航地图，细节靠锚点回到原话。\n\n## 候选缓存区 MEMORY_CACHE/*.md\n\n- 存固定但不常用的背景：人物称呼映射、个人暗语和缩写、历史项目代号、账号与环境参数、低频偏好。\n- 按类别分文件，文件名英文，例如 `MEMORY_CACHE/people.md`、`MEMORY_CACHE/slang.md`。不维护总目录。\n- 一行一个条目，键在前：`- 老张：供应商张伟，负责显示器报价 [confirmed] [#msg_8]`。键就是用户会说出口的那个词。\n\n## 热区 MEMORY.md\n\n- 每次检索都会注入，硬上限 200 行。只放已确认、经常用到的核心背景和高频暗语。\n- 禁止出现 `[inferred]` 条目。\n- 格式与缓存区相同：`- 键：解释 [#msg_N]`，按类别用 `## 小节` 分组。"
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
    "dimensions": 1024
   },
   {
    "key": "gte-rerank-v2",
    "label": "通义 gte-rerank-v2",
    "provider": "qwen",
    "protocol": "dashscope-rerank",
    "base_url": "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank",
    "model": "gte-rerank-v2"
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
