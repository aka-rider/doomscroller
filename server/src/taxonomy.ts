// Hierarchical tag taxonomy: 22 categories × ~30-50 tags each ≈ 750 topic tags + 14 signal tags.
// Categories are the first-pass filter for disambiguation (e.g. "Rust" in Programming ≠ chemistry).
// Tags are the second-pass fine-grained classification within their parent category.
//
// Each description is written to maximize embedding similarity to relevant articles
// while including category context for disambiguation.

export interface CategoryDef {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly sort_order: number;
}

export interface TagDef {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly tag_group: 'topic' | 'signal';
  readonly category_slug: string | null;
  readonly sort_order: number;
}

// ─── CATEGORIES ─────────────────────────────────────────────────────────────

export const BUILTIN_CATEGORIES: readonly CategoryDef[] = [
  {
    slug: 'programming',
    label: 'Programming',
    description: 'Programming languages, language design, syntax, type systems, compilers, interpreters, package managers, language ecosystems, coding practices, and developer experience for specific programming languages',
    sort_order: 1,
  },
  {
    slug: 'engineering',
    label: 'Software Engineering',
    description: 'Software engineering practices, system design, web development, databases, distributed systems, DevOps, cloud infrastructure, testing, networking, operating systems, APIs, mobile development, data engineering, and developer tooling',
    sort_order: 2,
  },
  {
    slug: 'ai-ml',
    label: 'AI & ML',
    description: 'Artificial intelligence, machine learning, large language models, computer vision, natural language processing, robotics, AI research, AI policy and safety, AI tools and frameworks, generative AI, and autonomous agents',
    sort_order: 3,
  },
  {
    slug: 'security',
    label: 'Security',
    description: 'Cybersecurity, vulnerability research, malware analysis, application security, network security, privacy, surveillance, cryptography, supply chain security, identity and authentication, and security operations',
    sort_order: 4,
  },
  {
    slug: 'hardware',
    label: 'Hardware & Electronics',
    description: 'Computer hardware, semiconductors, GPUs, consumer electronics, Apple products, Android devices, hardware hacking, maker culture, IoT devices, RISC-V, FPGAs, and electronics engineering',
    sort_order: 5,
  },
  {
    slug: 'science',
    label: 'Science',
    description: 'Natural sciences including physics, biology, chemistry, neuroscience, genetics, medicine, psychology, mathematics, materials science, climate science, ecology, geology, and scientific research methods',
    sort_order: 6,
  },
  {
    slug: 'space',
    label: 'Space',
    description: 'Space exploration, spaceflight, astronomy, planetary science, cosmology, commercial space industry, NASA, SpaceX, telescopes, satellites, astrobiology, and space policy',
    sort_order: 7,
  },
  {
    slug: 'energy',
    label: 'Energy & Environment',
    description: 'Energy production and policy, renewable energy, nuclear power, fossil fuels, electric vehicles, battery technology, carbon capture, environmental conservation, water resources, and sustainability',
    sort_order: 8,
  },
  {
    slug: 'politics',
    label: 'Politics',
    description: 'Government and politics, US politics, European Union politics, China, India, elections, legislation, regulation, human rights, trade policy, war and conflict, diplomacy, and international relations',
    sort_order: 9,
  },
  {
    slug: 'economics',
    label: 'Economics & Finance',
    description: 'Economics, financial markets, central banking, monetary policy, housing, labor markets, cryptocurrency, personal finance, taxation, commodities, and macroeconomic analysis',
    sort_order: 10,
  },
  {
    slug: 'business',
    label: 'Business & Startups',
    description: 'Business news, startups, venture capital, entrepreneurship, company management, acquisitions and mergers, IPOs, remote work, corporate strategy, and tech industry business',
    sort_order: 11,
  },
  {
    slug: 'gaming',
    label: 'Gaming',
    description: 'Video games, PC gaming, console gaming, indie games, game development, esports, retro gaming, VR gaming, tabletop games, game design, and gaming culture',
    sort_order: 12,
  },
  {
    slug: 'film-tv',
    label: 'Film & TV',
    description: 'Movies, television, film criticism, TV series, streaming services, documentaries, animation, anime, box office, film festivals, and entertainment industry news',
    sort_order: 13,
  },
  {
    slug: 'music',
    label: 'Music',
    description: 'Music genres, album reviews, music industry, live concerts, electronic music, hip-hop, rock, classical, jazz, metal, indie music, music production, and music technology',
    sort_order: 14,
  },
  {
    slug: 'sports',
    label: 'Sports',
    description: 'Professional and amateur sports, baseball, basketball, American football, soccer/football, tennis, golf, Formula 1, MMA, boxing, cricket, rugby, hockey, Olympics, and sports analytics',
    sort_order: 15,
  },
  {
    slug: 'food',
    label: 'Food & Drink',
    description: 'Food culture, restaurants, cooking, recipes, baking, food science, wine, coffee, cocktails, beer, food industry, nutrition science, and culinary arts',
    sort_order: 16,
  },
  {
    slug: 'books',
    label: 'Books & Literature',
    description: 'Books, literary criticism, fiction, non-fiction, science fiction and fantasy literature, poetry, publishing industry, book reviews, authors, and reading culture',
    sort_order: 17,
  },
  {
    slug: 'design',
    label: 'Design & Art',
    description: 'Design disciplines, graphic design, UX/UI design, industrial design, architecture, interior design, typography, photography, fine art, illustration, and visual culture',
    sort_order: 18,
  },
  {
    slug: 'health',
    label: 'Health & Fitness',
    description: 'Health and wellness, fitness training, running, weightlifting, yoga, mental health, nutrition, sleep science, longevity research, biotech, and medical health topics',
    sort_order: 19,
  },
  {
    slug: 'education',
    label: 'Education',
    description: 'Education policy, online learning, universities, MOOCs, teaching methods, EdTech, STEM education, student life, academic research, and educational technology',
    sort_order: 20,
  },
  {
    slug: 'travel',
    label: 'Travel & Transportation',
    description: 'Travel destinations, travel guides, tourism, airlines, aviation, railways, public transit, urban planning, cycling infrastructure, logistics, and transportation policy',
    sort_order: 21,
  },
  {
    slug: 'history',
    label: 'History & Philosophy',
    description: 'Historical events, ancient history, modern history, archaeology, philosophy, ethics, epistemology, political philosophy, philosophy of mind, and intellectual history',
    sort_order: 22,
  },
];

// ─── TOPIC TAGS ─────────────────────────────────────────────────────────────

let _order = 0;
const t = (slug: string, label: string, description: string, category_slug: string): TagDef => ({
  slug, label, description, tag_group: 'topic', category_slug, sort_order: ++_order,
});

const PROGRAMMING_TAGS: TagDef[] = [
  t('rust', 'Rust', 'The Rust programming language, ownership model, borrow checker, lifetimes, cargo package manager, crates.io ecosystem, systems programming in Rust', 'programming'),
  t('go', 'Go', 'The Go programming language (Golang), goroutines, channels, concurrency patterns, Go modules, Go standard library, static binaries', 'programming'),
  t('python', 'Python', 'Python programming language, pip, virtual environments, CPython, type hints, async/await in Python, data science with Python', 'programming'),
  t('typescript', 'TypeScript', 'TypeScript language, static typing for JavaScript, TypeScript type system, tsc compiler, declaration files, generics', 'programming'),
  t('javascript', 'JavaScript', 'JavaScript language, ES modules, ECMAScript, V8 engine, browser JavaScript APIs, npm ecosystem, event loop', 'programming'),
  t('c-cpp', 'C/C++', 'C and C++ programming languages, manual memory management, pointers, C++ templates, STL, cmake, gcc, clang compiler', 'programming'),
  t('java', 'Java', 'Java programming language, JVM, Spring Boot, Gradle, Maven, Java generics, Java concurrency, OpenJDK', 'programming'),
  t('kotlin', 'Kotlin', 'Kotlin programming language, Kotlin coroutines, Kotlin multiplatform, Kotlin for Android, JetBrains Kotlin', 'programming'),
  t('scala', 'Scala', 'Scala programming language, Scala 3, functional programming in Scala, Akka, Play Framework, sbt build tool', 'programming'),
  t('swift', 'Swift', 'Swift programming language, SwiftUI framework, iOS/macOS development with Swift, Swift Package Manager, Swift concurrency', 'programming'),
  t('zig', 'Zig', 'Zig programming language, comptime metaprogramming, manual memory management, Zig as C replacement, Zig build system', 'programming'),
  t('ruby', 'Ruby', 'Ruby programming language, Ruby on Rails framework, gems, Bundler, Ruby metaprogramming, RubyGems ecosystem', 'programming'),
  t('php', 'PHP', 'PHP programming language, Laravel framework, Composer, WordPress development, PHP 8 features, PHP-FPM', 'programming'),
  t('csharp-dotnet', 'C#/.NET', 'C# programming language, .NET runtime, ASP.NET, Entity Framework, Blazor, NuGet packages, MAUI', 'programming'),
  t('elixir', 'Elixir', 'Elixir programming language, Phoenix framework, OTP, BEAM virtual machine, Erlang ecosystem, LiveView', 'programming'),
  t('haskell', 'Haskell', 'Haskell programming language, pure functional programming, monads, GHC compiler, Cabal, Stack, lazy evaluation', 'programming'),
  t('ocaml', 'OCaml', 'OCaml programming language, ML family, algebraic data types, pattern matching in OCaml, opam, Dune build system', 'programming'),
  t('clojure', 'Clojure', 'Clojure programming language, Lisp on JVM, ClojureScript, immutable data structures, REPL-driven development', 'programming'),
  t('erlang', 'Erlang', 'Erlang programming language, BEAM VM, OTP framework, fault-tolerant distributed systems, actor model in Erlang', 'programming'),
  t('r-lang', 'R', 'R programming language, statistical computing, R Studio, CRAN, tidyverse, ggplot2, data analysis in R', 'programming'),
  t('julia', 'Julia', 'Julia programming language, scientific computing, multiple dispatch, Julia for machine learning, JuliaHub', 'programming'),
  t('dart', 'Dart', 'Dart programming language, Flutter framework, Dart for mobile development, pub.dev package manager', 'programming'),
  t('lua', 'Lua', 'Lua scripting language, game scripting with Lua, embedded Lua, LuaJIT, Lua tables, Neovim Lua configuration', 'programming'),
  t('nim', 'Nim', 'Nim programming language, compiled language with Python-like syntax, Nim metaprogramming, Nimble package manager', 'programming'),
  t('v-lang', 'V', 'V programming language (Vlang), fast compilation, simple syntax, V as C alternative, memory safety in V', 'programming'),
  t('assembly', 'Assembly', 'Assembly language programming, x86 assembly, ARM assembly, RISC-V assembly, low-level machine code, CPU instructions', 'programming'),
  t('shell-scripting', 'Shell Scripting', 'Shell scripting, Bash scripts, Zsh, POSIX shell, command-line automation, terminal scripting, shell utilities', 'programming'),
  t('functional-programming', 'Functional Programming', 'Functional programming paradigm, immutability, pure functions, monads, algebraic data types, pattern matching, category theory in programming', 'programming'),
  t('language-design', 'Language Design', 'Programming language design, type theory, language semantics, new programming language development, PL research', 'programming'),
];

const ENGINEERING_TAGS: TagDef[] = [
  t('systems-programming', 'Systems Programming', 'Low-level systems programming, operating system internals, kernels, device drivers, memory allocators, embedded firmware', 'engineering'),
  t('web-dev', 'Web Development', 'Web development, frontend frameworks, React, Vue, Svelte, SolidJS, Angular, CSS, HTML, web standards, browser compatibility', 'engineering'),
  t('backend-dev', 'Backend Development', 'Backend web development, server-side programming, web servers, middleware, authentication systems, session management', 'engineering'),
  t('database-internals', 'Database Internals', 'Database engine internals, query planners, B-trees, LSM trees, WAL, MVCC, storage engines, SQLite internals, PostgreSQL internals', 'engineering'),
  t('distributed-systems', 'Distributed Systems', 'Distributed systems design, consensus algorithms, Raft, Paxos, CAP theorem, eventual consistency, replication, sharding', 'engineering'),
  t('compilers', 'Compilers', 'Compiler design, parsing, ASTs, code generation, LLVM, interpreters, language implementation, type checkers, JIT compilation', 'engineering'),
  t('devops', 'DevOps', 'DevOps practices, CI/CD pipelines, infrastructure as code, Terraform, Ansible, deployment automation, GitOps, SRE', 'engineering'),
  t('cloud-infra', 'Cloud Infrastructure', 'Cloud computing platforms, AWS, GCP, Azure, serverless, containers, Kubernetes, Docker, microservices orchestration', 'engineering'),
  t('performance', 'Performance', 'Software performance optimization, profiling, benchmarking, latency reduction, throughput optimization, caching strategies', 'engineering'),
  t('developer-tools', 'Developer Tools', 'Developer tooling, IDEs, editors, debuggers, linters, formatters, build systems, package managers, CLI utilities', 'engineering'),
  t('open-source', 'Open Source', 'Open source software projects, FOSS community, licensing (MIT, GPL, Apache), maintainership, open source sustainability', 'engineering'),
  t('testing', 'Testing', 'Software testing, unit tests, integration tests, end-to-end testing, test frameworks, TDD, property-based testing, fuzzing', 'engineering'),
  t('networking', 'Networking', 'Computer networking, TCP/IP, HTTP/2, HTTP/3, DNS, BGP, network protocols, CDNs, load balancers, packet analysis', 'engineering'),
  t('operating-systems', 'Operating Systems', 'Operating system design, Linux kernel, Windows internals, macOS internals, scheduling, file systems, process management', 'engineering'),
  t('browsers', 'Browsers', 'Web browser technology, rendering engines, Chromium, Firefox, WebKit, browser extensions, web performance, PWAs', 'engineering'),
  t('api-design', 'API Design', 'API design patterns, REST, GraphQL, gRPC, protocol buffers, API versioning, OpenAPI specifications, webhooks', 'engineering'),
  t('mobile-dev', 'Mobile Development', 'Mobile app development, iOS development, Android development, React Native, Flutter, mobile UI/UX, app store distribution', 'engineering'),
  t('data-engineering', 'Data Engineering', 'Data pipelines, ETL/ELT, data warehouses, Apache Spark, Kafka, stream processing, data lakes, dbt, Airflow', 'engineering'),
  t('self-hosted', 'Self-Hosted', 'Self-hosted software, homelab setups, running your own services, Docker self-hosting, privacy-focused alternatives', 'engineering'),
  t('linux', 'Linux', 'Linux distributions, Linux desktop, system administration, bash scripting, package managers, Linux kernel development', 'engineering'),
  t('version-control', 'Version Control', 'Git, version control systems, branching strategies, monorepo tooling, code review workflows, GitHub, GitLab', 'engineering'),
  t('microservices', 'Microservices', 'Microservice architecture, service mesh, API gateways, inter-service communication, service discovery, circuit breakers', 'engineering'),
  t('observability', 'Observability', 'Observability, logging, monitoring, tracing, metrics, OpenTelemetry, Grafana, Prometheus, distributed tracing, alerting', 'engineering'),
  t('edge-computing', 'Edge Computing', 'Edge computing, CDN-based compute, edge functions, Cloudflare Workers, Deno Deploy, Vercel Edge, latency reduction at the edge', 'engineering'),
  t('wasm', 'WebAssembly', 'WebAssembly (WASM), WASI, WASM runtimes, browser WASM, server-side WASM, component model, WASM toolchains', 'engineering'),
];

const AI_ML_TAGS: TagDef[] = [
  t('llms', 'LLMs', 'Large language models, GPT, Claude, Llama, transformer architecture, fine-tuning, prompt engineering, inference optimization', 'ai-ml'),
  t('computer-vision', 'Computer Vision', 'Computer vision, image recognition, object detection, segmentation, CNNs, diffusion models, image generation', 'ai-ml'),
  t('robotics', 'Robotics', 'Robotics engineering, autonomous systems, robot control, ROS, manipulation, locomotion, robot perception, humanoid robots', 'ai-ml'),
  t('ml-research', 'ML Research', 'Machine learning research papers, novel architectures, training techniques, benchmarks, academic ML advances, foundation models', 'ai-ml'),
  t('ai-policy', 'AI Policy', 'AI regulation, AI safety policy, AI governance, ethical AI frameworks, AI legislation, responsible AI deployment', 'ai-ml'),
  t('ai-safety', 'AI Safety', 'AI alignment research, existential risk from AI, RLHF, constitutional AI, interpretability, mechanistic interpretability', 'ai-ml'),
  t('ai-tooling', 'AI Tooling', 'AI development tools, ML frameworks, PyTorch, TensorFlow, Hugging Face, model serving, ML ops, vector databases', 'ai-ml'),
  t('nlp', 'NLP', 'Natural language processing, text analysis, sentiment analysis, named entity recognition, machine translation, tokenization', 'ai-ml'),
  t('generative-art', 'Generative Art', 'AI-generated art, Stable Diffusion, Midjourney, DALL-E, creative AI, procedural generation, neural style transfer', 'ai-ml'),
  t('ai-agents', 'AI Agents', 'Autonomous AI agents, tool use, multi-agent systems, agent frameworks, AI assistants, agent orchestration, function calling', 'ai-ml'),
  t('reinforcement-learning', 'Reinforcement Learning', 'Reinforcement learning, reward modeling, policy optimization, multi-armed bandits, RL in games, sim-to-real transfer', 'ai-ml'),
  t('speech-audio', 'Speech & Audio AI', 'Speech recognition, text-to-speech, audio generation, music AI, voice cloning, Whisper, audio classification', 'ai-ml'),
  t('recommendation-systems', 'Recommendation Systems', 'Recommendation engines, collaborative filtering, content-based filtering, search ranking, personalization algorithms', 'ai-ml'),
  t('synthetic-data', 'Synthetic Data', 'Synthetic data generation, data augmentation, simulation for ML training, privacy-preserving synthetic datasets', 'ai-ml'),
  t('ml-infrastructure', 'ML Infrastructure', 'ML infrastructure, training clusters, GPU clusters, distributed training, model deployment, inference optimization, quantization', 'ai-ml'),
];

const SECURITY_TAGS: TagDef[] = [
  t('vulnerability-research', 'Vulnerability Research', 'Security vulnerability discovery, CVEs, zero-day exploits, bug bounties, responsible disclosure, proof-of-concept exploits', 'security'),
  t('malware-analysis', 'Malware Analysis', 'Malware reverse engineering, threat analysis, ransomware, trojans, APT campaigns, indicators of compromise', 'security'),
  t('network-security', 'Network Security', 'Network security, firewalls, intrusion detection, DDoS mitigation, VPNs, network monitoring, traffic analysis', 'security'),
  t('appsec', 'Application Security', 'Application security, OWASP, secure coding, penetration testing, web application vulnerabilities, code auditing', 'security'),
  t('privacy', 'Privacy', 'Digital privacy, data protection, GDPR, surveillance resistance, encryption, privacy-preserving technologies, data brokers', 'security'),
  t('surveillance', 'Surveillance', 'Government surveillance programs, mass data collection, facial recognition, wiretapping, intelligence agencies, SIGINT', 'security'),
  t('cryptography', 'Cryptography', 'Cryptographic algorithms, TLS, encryption protocols, post-quantum cryptography, key management, digital signatures', 'security'),
  t('supply-chain-security', 'Supply Chain Security', 'Software supply chain attacks, dependency security, package registry poisoning, SBOM, code signing, reproducible builds', 'security'),
  t('identity-auth', 'Identity & Auth', 'Authentication systems, OAuth, OIDC, passkeys, FIDO2, SSO, identity management, access control, zero trust', 'security'),
  t('incident-response', 'Incident Response', 'Security incident response, digital forensics, threat hunting, SIEM, SOC operations, breach investigation', 'security'),
  t('cloud-security', 'Cloud Security', 'Cloud security posture, AWS security, container security, Kubernetes security, IAM policies, cloud misconfigurations', 'security'),
];

const HARDWARE_TAGS: TagDef[] = [
  t('semiconductors', 'Semiconductors', 'Semiconductor industry, chip fabrication, TSMC, Intel, AMD, process nodes, EUV lithography, chip shortages', 'hardware'),
  t('gpus', 'GPUs', 'Graphics processing units, NVIDIA, AMD Radeon, GPU computing, CUDA, graphics cards, GPU architecture, AI accelerators', 'hardware'),
  t('hardware-hacking', 'Hardware Hacking', 'Hardware tinkering, electronics projects, Arduino, Raspberry Pi, PCB design, 3D printing, maker culture, soldering', 'hardware'),
  t('consumer-tech', 'Consumer Tech', 'Consumer electronics, smartphones, laptops, tablets, wearables, smart home devices, product reviews, gadgets', 'hardware'),
  t('apple', 'Apple', 'Apple Inc products and ecosystem, iPhone, Mac, iPad, Apple Watch, macOS, iOS, WWDC announcements, Apple Silicon', 'hardware'),
  t('android', 'Android', 'Android operating system, Google Pixel, Samsung Galaxy, Android development, Google Play Store, Android updates', 'hardware'),
  t('risc-v', 'RISC-V', 'RISC-V open instruction set architecture, RISC-V processors, RISC-V ecosystem, open hardware', 'hardware'),
  t('fpgas', 'FPGAs', 'Field-programmable gate arrays, FPGA development, Verilog, VHDL, hardware description languages, Xilinx, Altera', 'hardware'),
  t('iot', 'IoT', 'Internet of Things devices, smart sensors, embedded IoT, home automation, industrial IoT, ESP32, connectivity protocols', 'hardware'),
  t('networking-hardware', 'Networking Hardware', 'Routers, switches, network equipment, WiFi 7, 5G infrastructure, fiber optics, mesh networking hardware', 'hardware'),
  t('storage', 'Storage', 'Storage technology, SSDs, NVMe, hard drives, NAS devices, storage protocols, data center storage, flash memory', 'hardware'),
  t('right-to-repair', 'Right to Repair', 'Right to repair legislation, repairability, planned obsolescence, device teardowns, repair guides, iFixit', 'hardware'),
];

const SCIENCE_TAGS: TagDef[] = [
  t('physics', 'Physics', 'Physics research, quantum mechanics, particle physics, condensed matter, thermodynamics, astrophysics theory, experimental physics', 'science'),
  t('biology', 'Biology', 'Biology research, molecular biology, cell biology, evolutionary biology, ecology, microbiology, synthetic biology', 'science'),
  t('chemistry', 'Chemistry', 'Chemistry research, organic chemistry, materials chemistry, chemical engineering, catalysis, electrochemistry, biochemistry', 'science'),
  t('neuroscience', 'Neuroscience', 'Neuroscience research, brain imaging, cognitive neuroscience, neural circuits, brain-computer interfaces, neuroplasticity', 'science'),
  t('climate-science', 'Climate Science', 'Climate change research, global warming data, climate models, carbon emissions, climate feedback loops, IPCC reports', 'science'),
  t('genetics', 'Genetics', 'Genetics research, genomics, CRISPR gene editing, DNA sequencing, hereditary diseases, gene therapy, epigenetics', 'science'),
  t('materials-science', 'Materials Science', 'Materials science research, novel materials, superconductors, metamaterials, graphene, nanotechnology, composites', 'science'),
  t('medicine', 'Medicine', 'Medical research, clinical trials, drug development, disease treatment, public health, epidemiology, vaccines, FDA approvals', 'science'),
  t('psychology', 'Psychology', 'Psychology research, cognitive psychology, behavioral science, mental health research, social psychology, developmental psychology', 'science'),
  t('math', 'Mathematics', 'Mathematics, number theory, algebra, topology, mathematical proofs, applied mathematics, statistics, combinatorics', 'science'),
  t('ecology', 'Ecology', 'Ecology research, ecosystems, biodiversity, conservation biology, species interactions, population dynamics, ecological modeling', 'science'),
  t('geology', 'Geology', 'Geology, earth sciences, plate tectonics, volcanology, seismology, mineralogy, paleontology, geological surveys', 'science'),
  t('oceanography', 'Oceanography', 'Oceanography, marine science, ocean currents, marine biology, deep sea exploration, coral reefs, ocean chemistry', 'science'),
  t('biotech', 'Biotech', 'Biotechnology industry, biotech companies, drug development pipelines, bioinformatics, protein engineering, bioprocessing', 'science'),
  t('scientific-methods', 'Scientific Methods', 'Scientific methodology, peer review, replication crisis, open science, preprints, research ethics, meta-analysis', 'science'),
];

const SPACE_TAGS: TagDef[] = [
  t('spaceflight', 'Spaceflight', 'Space launches, rockets, SpaceX, NASA missions, space stations, crewed spaceflight, orbital mechanics, reusable rockets', 'space'),
  t('astronomy', 'Astronomy', 'Astronomical observations, telescopes, JWST, Hubble, star systems, galaxies, nebulae, astronomical surveys, stargazing', 'space'),
  t('planetary-science', 'Planetary Science', 'Planetary science, Mars exploration, exoplanets, planetary geology, solar system bodies, planetary atmospheres', 'space'),
  t('cosmology', 'Cosmology', 'Cosmology research, dark matter, dark energy, Big Bang theory, cosmic microwave background, universe expansion, black holes', 'space'),
  t('space-industry', 'Space Industry', 'Commercial space industry, satellite companies, space tourism, Starlink, Blue Origin, space economy, launch providers', 'space'),
  t('astrobiology', 'Astrobiology', 'Astrobiology, search for extraterrestrial life, biosignatures, habitable zones, extremophiles, Drake equation', 'space'),
  t('lunar-exploration', 'Lunar Exploration', 'Moon exploration, Artemis program, lunar landers, lunar bases, Moon resources, cislunar economy', 'space'),
  t('satellite-tech', 'Satellite Technology', 'Satellite technology, satellite constellations, Earth observation, GPS, satellite internet, CubeSats, satellite imaging', 'space'),
  t('space-policy', 'Space Policy', 'Space policy, space treaties, Outer Space Treaty, space debris policy, space governance, international space cooperation', 'space'),
];

const ENERGY_TAGS: TagDef[] = [
  t('renewable-energy', 'Renewable Energy', 'Renewable energy sources, solar power, wind energy, geothermal energy, hydropower, green hydrogen, energy transition', 'energy'),
  t('nuclear-energy', 'Nuclear Energy', 'Nuclear power, fusion research, fission reactors, SMRs, nuclear waste, nuclear policy, thorium reactors, ITER', 'energy'),
  t('environment', 'Environment', 'Environmental issues, pollution, conservation, deforestation, ocean health, environmental policy, biodiversity loss', 'energy'),
  t('electric-vehicles', 'Electric Vehicles', 'Electric vehicles, Tesla, EV charging infrastructure, battery technology, autonomous driving, electric car market', 'energy'),
  t('grid-storage', 'Grid & Storage', 'Energy grid, battery storage, grid modernization, energy storage systems, smart grid, power distribution, microgrids', 'energy'),
  t('fossil-fuels', 'Fossil Fuels', 'Oil and gas industry, coal, natural gas, fossil fuel divestment, petroleum, OPEC, energy prices, fracking', 'energy'),
  t('carbon-capture', 'Carbon Capture', 'Carbon capture and storage (CCS), direct air capture, carbon sequestration, carbon credits, carbon markets, net zero technology', 'energy'),
  t('water-resources', 'Water Resources', 'Water management, water scarcity, desalination, wastewater treatment, water infrastructure, drought, water policy', 'energy'),
  t('sustainable-agriculture', 'Sustainable Agriculture', 'Sustainable farming, regenerative agriculture, vertical farming, food systems, agricultural technology, soil health', 'energy'),
];

const POLITICS_TAGS: TagDef[] = [
  t('us-politics', 'US Politics', 'United States domestic politics, Congress, White House, Supreme Court, federal policy, political parties, US legislation', 'politics'),
  t('eu-politics', 'EU Politics', 'European Union politics, EU Parliament, European Commission, Brexit aftermath, EU regulations, member state politics', 'politics'),
  t('china', 'China', 'China news, Chinese politics, CCP, US-China relations, Chinese technology sector, Chinese economy, Taiwan strait', 'politics'),
  t('india', 'India', 'India news, Indian politics, Modi government, Indian economy, Indian technology sector, India-Pakistan relations', 'politics'),
  t('latin-america', 'Latin America', 'Latin American politics, Brazil, Mexico, Argentina, Chile, Latin American economy, regional geopolitics', 'politics'),
  t('africa', 'Africa', 'African politics, African economies, African technology, Sub-Saharan Africa, North Africa, African development', 'politics'),
  t('middle-east', 'Middle East', 'Middle Eastern politics, Israel-Palestine, Iran, Saudi Arabia, Gulf states, Middle East conflicts, Arab world', 'politics'),
  t('elections', 'Elections', 'Elections worldwide, voting, campaign coverage, election results, polling, electoral systems, election integrity', 'politics'),
  t('regulation', 'Regulation', 'Government regulation, antitrust, tech regulation, Section 230, content moderation policy, regulatory agencies', 'politics'),
  t('human-rights', 'Human Rights', 'Human rights issues, civil liberties, press freedom, refugee crises, humanitarian aid, discrimination, asylum', 'politics'),
  t('trade-policy', 'Trade Policy', 'International trade policy, tariffs, trade agreements, sanctions, WTO, supply chain geopolitics, trade wars', 'politics'),
  t('war-conflict', 'War & Conflict', 'Armed conflicts, wars, military operations, defense policy, peacekeeping, geopolitical tensions, military technology', 'politics'),
  t('diplomacy', 'Diplomacy', 'International diplomacy, treaties, summits, foreign policy, embassies, international organizations, UN, NATO', 'politics'),
  t('local-politics', 'Local Politics', 'Local government, city politics, state politics, municipal policy, local elections, zoning, city councils', 'politics'),
];

const ECONOMICS_TAGS: TagDef[] = [
  t('markets', 'Markets', 'Stock markets, equity trading, market analysis, S&P 500, NASDAQ, market volatility, investor sentiment, ETFs', 'economics'),
  t('central-banks', 'Central Banks', 'Central bank policy, Federal Reserve, ECB, Bank of Japan, interest rates, monetary policy, quantitative easing, inflation targeting', 'economics'),
  t('housing', 'Housing', 'Housing market, real estate, home prices, mortgage rates, rental market, housing policy, affordable housing, housing supply', 'economics'),
  t('labor-market', 'Labor Market', 'Employment, jobs data, labor statistics, layoffs, hiring trends, wage growth, labor unions, unemployment, workforce', 'economics'),
  t('crypto-markets', 'Crypto Markets', 'Cryptocurrency markets, Bitcoin price, Ethereum, DeFi protocols, crypto exchanges, blockchain tokens, stablecoins, NFTs', 'economics'),
  t('personal-finance', 'Personal Finance', 'Personal finance advice, investing strategies, budgeting, retirement planning, credit cards, savings, financial literacy', 'economics'),
  t('taxation', 'Taxation', 'Tax policy, income tax, corporate tax, tax reform, IRS, international taxation, capital gains tax, tax planning', 'economics'),
  t('commodities', 'Commodities', 'Commodity markets, gold, silver, oil prices, agricultural commodities, commodity trading, supply and demand fundamentals', 'economics'),
  t('insurance', 'Insurance', 'Insurance industry, health insurance, life insurance, property insurance, insurance regulation, actuarial science', 'economics'),
  t('fintech', 'Fintech', 'Financial technology, digital banking, payment processing, neobanks, fintech startups, blockchain finance, DeFi platforms', 'economics'),
  t('macroeconomics', 'Macroeconomics', 'Macroeconomic analysis, GDP, inflation, recession, economic indicators, fiscal policy, global economic trends', 'economics'),
];

const BUSINESS_TAGS: TagDef[] = [
  t('startups', 'Startups', 'Startup ecosystem, venture capital, seed funding, YCombinator, startup culture, founder stories, unicorns, pitch decks', 'business'),
  t('acquisitions', 'Acquisitions & M&A', 'Mergers and acquisitions, corporate buyouts, company acquisitions, M&A deal analysis, antitrust review, hostile takeovers', 'business'),
  t('ipos', 'IPOs', 'Initial public offerings, SPACs, company going public, stock market debuts, IPO pricing, direct listings', 'business'),
  t('management', 'Management', 'Corporate management, leadership, organizational design, company culture, executive decisions, team building', 'business'),
  t('remote-work', 'Remote Work', 'Remote work, distributed teams, work from home, hybrid work, digital nomad, remote work tools, async communication', 'business'),
  t('big-tech', 'Big Tech', 'Big tech companies, FAANG, Google, Apple, Microsoft, Amazon, Meta, tech industry consolidation, big tech antitrust', 'business'),
  t('venture-capital', 'Venture Capital', 'Venture capital industry, VC funding rounds, LP investing, venture returns, VC firm strategy, growth equity', 'business'),
  t('saas', 'SaaS', 'Software as a service, SaaS business models, SaaS metrics, ARR, churn, B2B SaaS, SaaS pricing strategies', 'business'),
  t('e-commerce', 'E-Commerce', 'E-commerce platforms, online retail, Shopify, Amazon marketplace, direct-to-consumer, e-commerce logistics', 'business'),
  t('creator-economy', 'Creator Economy', 'Creator economy, content creators, Patreon, YouTube monetization, newsletter business, influencer economy, creator tools', 'business'),
];

const GAMING_TAGS: TagDef[] = [
  t('pc-gaming', 'PC Gaming', 'PC gaming, Steam platform, game hardware for PC, graphics settings, PC game releases, modding community', 'gaming'),
  t('console-gaming', 'Console Gaming', 'Console gaming, PlayStation, Xbox, Nintendo Switch, console exclusives, console hardware, next-gen consoles', 'gaming'),
  t('indie-games', 'Indie Games', 'Independent game development, indie game releases, small studio games, indie game festivals, itch.io, indie showcases', 'gaming'),
  t('game-dev', 'Game Development', 'Game development techniques, Unity engine, Unreal Engine, Godot, game design principles, game programming, game art pipelines', 'gaming'),
  t('esports', 'Esports', 'Competitive gaming, esports tournaments, professional gaming teams, esports leagues, Twitch streaming, competitive scenes', 'gaming'),
  t('retro-gaming', 'Retro Gaming', 'Retro gaming, classic games, emulation, retro consoles, game preservation, nostalgia gaming, ROM hacking', 'gaming'),
  t('vr-gaming', 'VR Gaming', 'Virtual reality gaming, VR headsets, Meta Quest, SteamVR, VR game development, immersive experiences', 'gaming'),
  t('tabletop', 'Tabletop Games', 'Tabletop games, board games, tabletop RPGs, Dungeons & Dragons, card games, miniature wargaming, game design', 'gaming'),
  t('game-narrative', 'Game Narrative', 'Game storytelling, narrative design in games, interactive fiction, branching narratives, game writing, world-building', 'gaming'),
  t('speedrunning', 'Speedrunning', 'Speedrunning, speedrun records, glitch exploitation, routing, GDQ events, speedrun categories, tool-assisted speedruns', 'gaming'),
  t('game-industry', 'Game Industry', 'Video game industry business, game studio news, game publisher deals, layoffs in gaming, game industry labor', 'gaming'),
  t('mmo', 'MMOs', 'Massively multiplayer online games, MMORPG, World of Warcraft, Final Fantasy XIV, MMO game design, online communities', 'gaming'),
];

const FILM_TV_TAGS: TagDef[] = [
  t('film-criticism', 'Film Criticism', 'Film reviews, movie analysis, cinema criticism, director profiles, cinematography analysis, film theory', 'film-tv'),
  t('tv-series', 'TV Series', 'Television series, TV show reviews, showrunners, TV drama, sitcoms, limited series, TV pilots, prestige TV', 'film-tv'),
  t('streaming', 'Streaming', 'Streaming services, Netflix, Disney+, HBO Max, Apple TV+, streaming wars, content licensing, subscriber numbers', 'film-tv'),
  t('documentaries', 'Documentaries', 'Documentary films, docuseries, true crime documentaries, nature documentaries, investigative documentaries', 'film-tv'),
  t('animation', 'Animation', 'Animation, animated films, Pixar, Studio Ghibli, DreamWorks, animation technology, animated series, stop motion', 'film-tv'),
  t('anime', 'Anime', 'Japanese anime, anime series, manga adaptations, anime studios, anime streaming, anime culture, seasonal anime', 'film-tv'),
  t('box-office', 'Box Office', 'Box office results, movie earnings, opening weekends, theatrical releases, movie business, Hollywood economics', 'film-tv'),
  t('horror', 'Horror', 'Horror films, horror TV shows, horror genre, slasher films, psychological horror, indie horror, horror directors', 'film-tv'),
  t('sci-fi-film', 'Sci-Fi Film & TV', 'Science fiction movies and TV shows, sci-fi franchises, Star Wars, Star Trek, cyberpunk, dystopian fiction on screen', 'film-tv'),
  t('franchise-news', 'Franchise News', 'Film franchise news, Marvel MCU, DC, franchise reboots, sequel announcements, universe expansions, casting news', 'film-tv'),
  t('film-festivals', 'Film Festivals', 'Film festivals, Cannes, Sundance, Venice, Toronto, Berlin, festival premieres, award season, festival circuit', 'film-tv'),
  t('reality-tv', 'Reality TV', 'Reality television, competition shows, dating shows, reality TV culture, unscripted programming', 'film-tv'),
];

const MUSIC_TAGS: TagDef[] = [
  t('album-reviews', 'Album Reviews', 'Music album reviews, new album releases, music criticism, album ratings, discography analysis, record reviews', 'music'),
  t('music-industry', 'Music Industry', 'Music business, record labels, streaming royalties, music rights, concert industry, music distribution, Spotify', 'music'),
  t('live-music', 'Live Music', 'Live concerts, music festivals, touring, concert reviews, live performance, venue news, Coachella, festival lineup', 'music'),
  t('electronic-music', 'Electronic Music', 'Electronic music, EDM, techno, house, ambient, synthwave, drum and bass, music production, synthesizers', 'music'),
  t('hip-hop', 'Hip-Hop', 'Hip-hop music, rap, hip-hop culture, hip-hop album releases, rap battles, hip-hop producers, trap, drill', 'music'),
  t('indie-music', 'Indie Music', 'Independent music, indie rock, indie pop, small label releases, underground music, DIY music, shoegaze, lo-fi', 'music'),
  t('classical-music', 'Classical', 'Classical music, orchestras, operas, classical composers, symphonies, chamber music, classical performance', 'music'),
  t('jazz', 'Jazz', 'Jazz music, jazz artists, jazz albums, bebop, jazz fusion, contemporary jazz, jazz history, improvisation', 'music'),
  t('metal', 'Metal', 'Heavy metal music, thrash metal, death metal, black metal, prog metal, metalcore, metal bands, metal festivals', 'music'),
  t('country', 'Country', 'Country music, Americana, country artists, Nashville, country albums, folk-country, bluegrass, alt-country', 'music'),
  t('kpop', 'K-Pop', 'Korean pop music, K-pop groups, BTS, BLACKPINK, K-pop industry, Korean music, idol groups, K-pop fandom', 'music'),
  t('music-production', 'Music Production', 'Music production techniques, DAWs, Ableton, audio engineering, mixing, mastering, music technology, plugins', 'music'),
  t('rock', 'Rock', 'Rock music, classic rock, alternative rock, punk rock, post-punk, garage rock, rock bands, rock history', 'music'),
];

const SPORTS_TAGS: TagDef[] = [
  t('baseball', 'Baseball', 'Baseball, MLB, Major League Baseball, World Series, baseball stats, sabermetrics, spring training, baseball trades', 'sports'),
  t('basketball', 'Basketball', 'Basketball, NBA, NCAA basketball, basketball playoffs, basketball draft, WNBA, basketball analytics, March Madness', 'sports'),
  t('american-football', 'American Football', 'American football, NFL, Super Bowl, college football, football draft, quarterback rankings, fantasy football leagues', 'sports'),
  t('soccer', 'Soccer/Football', 'Soccer, football (association), Premier League, La Liga, Champions League, World Cup, MLS, transfers, football tactics', 'sports'),
  t('tennis', 'Tennis', 'Tennis, ATP, WTA, Grand Slam tournaments, Wimbledon, US Open, tennis rankings, tennis players, tennis analysis', 'sports'),
  t('golf', 'Golf', 'Golf, PGA Tour, The Masters, golf tournaments, golf equipment, LIV Golf, golf courses, professional golf', 'sports'),
  t('formula-1', 'Formula 1', 'Formula 1 racing, F1 Grand Prix, F1 teams, F1 drivers, race strategy, F1 regulations, motorsport engineering', 'sports'),
  t('mma', 'MMA', 'Mixed martial arts, UFC, MMA fights, UFC events, MMA fighters, combat sports, MMA techniques, Bellator', 'sports'),
  t('boxing', 'Boxing', 'Boxing, professional boxing, boxing matches, heavyweight boxing, boxing rankings, boxing history, fight night', 'sports'),
  t('cricket', 'Cricket', 'Cricket, Test cricket, ODI, T20, IPL, Ashes, cricket world cup, cricket scores, batting and bowling stats', 'sports'),
  t('rugby', 'Rugby', 'Rugby union, rugby league, Six Nations, Rugby World Cup, rugby teams, rugby analysis, Super Rugby', 'sports'),
  t('hockey', 'Hockey', 'Ice hockey, NHL, Stanley Cup, hockey playoffs, hockey trades, hockey analysis, Olympic hockey', 'sports'),
  t('volleyball', 'Volleyball', 'Volleyball, beach volleyball, volleyball leagues, FIVB, volleyball tournaments, Olympic volleyball', 'sports'),
  t('swimming', 'Swimming', 'Swimming, competitive swimming, Olympic swimming, swim records, swimming techniques, swim meets, aquatics', 'sports'),
  t('track-field', 'Track & Field', 'Track and field, athletics, Olympic track events, marathon running, sprinting records, field events, Diamond League', 'sports'),
  t('cycling-sport', 'Cycling', 'Competitive cycling, Tour de France, cycling races, road cycling, track cycling, mountain biking competitions', 'sports'),
  t('skiing', 'Skiing & Winter Sports', 'Skiing, snowboarding, Winter Olympics, alpine skiing, cross-country skiing, biathlon, winter sports competitions', 'sports'),
  t('surfing', 'Surfing', 'Surfing, competitive surfing, World Surf League, big wave surfing, surf culture, surfing competitions', 'sports'),
  t('motorsport', 'Motorsport', 'Motorsport, NASCAR, IndyCar, rally racing, endurance racing, Le Mans, MotoGP, motorcycle racing, WRC', 'sports'),
  t('wrestling', 'Wrestling', 'Professional wrestling, WWE, AEW, amateur wrestling, Olympic wrestling, pro wrestling news, wrestling events', 'sports'),
  t('table-tennis', 'Table Tennis', 'Table tennis, ping pong, ITTF, table tennis tournaments, Olympic table tennis, table tennis techniques', 'sports'),
  t('badminton', 'Badminton', 'Badminton, BWF, badminton tournaments, Olympic badminton, badminton world championships, shuttlecock sports', 'sports'),
  t('esports-competitive', 'Competitive Gaming', 'Esports as sports, competitive gaming tournaments, esports organizations, esports athletes, gaming competitions, LAN events', 'sports'),
  t('fantasy-sports', 'Fantasy Sports', 'Fantasy football, fantasy baseball, fantasy basketball, daily fantasy, fantasy sports strategy, DraftKings, FanDuel', 'sports'),
  t('sports-analytics', 'Sports Analytics', 'Sports analytics, advanced statistics, sports data science, player performance metrics, win probability, expected goals', 'sports'),
  t('olympics', 'Olympics', 'Olympic Games, Summer Olympics, Winter Olympics, IOC, Olympic athletes, Olympic records, Olympic host cities', 'sports'),
  t('combat-sports', 'Combat Sports', 'Combat sports, martial arts, judo, karate, taekwondo, fencing, martial arts competitions, combat athletics', 'sports'),
  t('extreme-sports', 'Extreme Sports', 'Extreme sports, skateboarding, BMX, climbing, X Games, parkour, base jumping, adventure sports competitions', 'sports'),
  t('horse-racing', 'Horse Racing', 'Horse racing, thoroughbred racing, Kentucky Derby, horse racing betting, jockeys, Breeders Cup, flat racing', 'sports'),
  t('sailing', 'Sailing', "Sailing, America's Cup, yacht racing, offshore sailing, Olympic sailing, sailing technology, competitive sailing", 'sports'),
];

const FOOD_TAGS: TagDef[] = [
  t('restaurants', 'Restaurants', 'Restaurant reviews, new restaurant openings, dining culture, Michelin stars, chef profiles, restaurant industry', 'food'),
  t('cooking', 'Cooking', 'Cooking techniques, home cooking, recipe development, culinary skills, cooking equipment, kitchen tips', 'food'),
  t('recipes', 'Recipes', 'Food recipes, meal planning, recipe sharing, weeknight dinners, seasonal recipes, recipe collections, cooking tutorials', 'food'),
  t('baking', 'Baking', 'Baking, bread making, pastry, sourdough, cake decorating, baking science, dessert recipes, artisan baking', 'food'),
  t('food-science', 'Food Science', 'Food science, food chemistry, fermentation, food preservation, molecular gastronomy, food safety, food processing', 'food'),
  t('wine', 'Wine', 'Wine, wine reviews, wine regions, viticulture, wine tasting, sommeliers, wine industry, natural wine', 'food'),
  t('coffee', 'Coffee', 'Coffee culture, specialty coffee, coffee brewing, espresso, coffee roasting, coffee shops, barista techniques', 'food'),
  t('cocktails', 'Cocktails & Spirits', 'Cocktails, mixology, spirits, whiskey, craft cocktails, bartending, distilleries, cocktail recipes', 'food'),
  t('beer', 'Beer', 'Beer, craft beer, breweries, beer styles, homebrew, beer reviews, IPA, stout, brewing industry', 'food'),
  t('food-industry', 'Food Industry', 'Food industry news, food companies, food supply chain, food regulation, food business, fast food, food trends', 'food'),
  t('nutrition', 'Nutrition', 'Nutrition science, dietary guidelines, vitamins, macronutrients, diet research, nutritional supplements, food labeling', 'food'),
  t('food-culture', 'Food Culture', 'Food culture, culinary traditions, regional cuisines, street food, food history, food writing, food media', 'food'),
];

const BOOKS_TAGS: TagDef[] = [
  t('fiction', 'Fiction', 'Fiction books, novels, literary fiction, contemporary fiction, fiction authors, fiction book reviews, storytelling', 'books'),
  t('non-fiction', 'Non-Fiction', 'Non-fiction books, memoirs, biographies, essays, narrative non-fiction, investigative journalism books', 'books'),
  t('sci-fi-lit', 'Sci-Fi & Fantasy', 'Science fiction literature, fantasy novels, sci-fi authors, fantasy world-building, speculative fiction, space opera', 'books'),
  t('poetry', 'Poetry', 'Poetry, poets, poetry collections, verse, spoken word, poetry readings, contemporary poetry, literary journals', 'books'),
  t('publishing', 'Publishing', 'Publishing industry, book publishers, self-publishing, ebook market, audiobooks, literary agents, book deals', 'books'),
  t('literary-criticism', 'Literary Criticism', 'Literary criticism, book analysis, literary theory, comparative literature, critical essays, literary movements', 'books'),
  t('comics-graphic', 'Comics & Graphic Novels', 'Comics, graphic novels, manga, comic book industry, comic artists, webcomics, comic book publishers', 'books'),
  t('book-culture', 'Book Culture', 'Book culture, reading habits, bookstores, libraries, book clubs, BookTok, book recommendations, literary festivals', 'books'),
];

const DESIGN_TAGS: TagDef[] = [
  t('graphic-design', 'Graphic Design', 'Graphic design, visual communication, branding, logo design, poster design, graphic design tools, design trends', 'design'),
  t('ux-design', 'UX/UI Design', 'User experience design, user interface design, interaction design, usability, design systems, Figma, wireframes', 'design'),
  t('industrial-design', 'Industrial Design', 'Industrial design, product design, manufacturing design, consumer product design, design engineering', 'design'),
  t('architecture', 'Architecture', 'Architecture, building design, architectural styles, urban architecture, sustainable architecture, architectural criticism', 'design'),
  t('interior-design', 'Interior Design', 'Interior design, home decor, spatial design, furniture design, interior styling, residential and commercial interiors', 'design'),
  t('typography', 'Typography', 'Typography, typeface design, fonts, lettering, typographic hierarchy, web typography, type foundries', 'design'),
  t('photography', 'Photography', 'Photography, cameras, photo editing, photojournalism, street photography, landscape photography, portrait photography', 'design'),
  t('fine-art', 'Fine Art', 'Fine art, contemporary art, art exhibitions, painting, sculpture, art galleries, art criticism, art market', 'design'),
  t('illustration', 'Illustration', 'Illustration, digital illustration, editorial illustration, concept art, character design, illustrators', 'design'),
  t('fashion', 'Fashion', 'Fashion industry, clothing design, fashion weeks, luxury brands, streetwear, fashion trends, style, haute couture', 'design'),
  t('motion-design', 'Motion Design', 'Motion graphics, animation design, video effects, After Effects, motion design tools, kinetic typography', 'design'),
  t('3d-design', '3D Design', '3D modeling, 3D rendering, Blender, CAD, 3D printing design, 3D visualization, architectural rendering', 'design'),
];

const HEALTH_TAGS: TagDef[] = [
  t('running', 'Running', 'Running, marathon training, trail running, ultramarathon, running shoes, running plans, race results, jogging', 'health'),
  t('weightlifting', 'Weightlifting', 'Weightlifting, strength training, powerlifting, bodybuilding, Olympic lifting, gym training, weight training programs', 'health'),
  t('yoga', 'Yoga', 'Yoga practice, yoga poses, yoga philosophy, meditation, mindfulness, yoga retreats, yoga styles, breathwork', 'health'),
  t('mental-health', 'Mental Health', 'Mental health, anxiety, depression, therapy, mental wellness, stress management, psychiatric research, mindfulness', 'health'),
  t('sleep', 'Sleep', 'Sleep science, sleep hygiene, insomnia, circadian rhythms, sleep research, sleep tracking, sleep disorders', 'health'),
  t('longevity', 'Longevity', 'Longevity research, anti-aging science, lifespan extension, senolytics, healthspan, aging biology, blue zones', 'health'),
  t('sports-medicine', 'Sports Medicine', 'Sports medicine, injury prevention, physical therapy, athletic recovery, sports injuries, rehabilitation', 'health'),
  t('fitness-tech', 'Fitness Tech', 'Fitness technology, fitness trackers, smartwatches for fitness, fitness apps, connected gym equipment, wearable health', 'health'),
  t('diet-nutrition', 'Diet & Nutrition', 'Diets, ketogenic diet, intermittent fasting, plant-based eating, calorie counting, diet trends, dietary science', 'health'),
  t('outdoor-fitness', 'Outdoor Fitness', 'Outdoor fitness, hiking, climbing, outdoor sports, adventure fitness, camping, backcountry, trail running', 'health'),
  t('public-health', 'Public Health', 'Public health policy, epidemiology, disease prevention, vaccination programs, health infrastructure, global health', 'health'),
];

const EDUCATION_TAGS: TagDef[] = [
  t('higher-ed', 'Higher Education', 'Universities, college admissions, higher education policy, academic institutions, graduate school, tuition costs', 'education'),
  t('online-learning', 'Online Learning', 'Online courses, MOOCs, Coursera, edX, Khan Academy, distance learning, virtual classrooms, online certifications', 'education'),
  t('edtech', 'EdTech', 'Educational technology, learning management systems, edtech startups, digital learning tools, classroom technology', 'education'),
  t('teaching', 'Teaching', 'Teaching methods, pedagogy, classroom instruction, teacher training, curriculum design, education reform, K-12 teaching', 'education'),
  t('stem-education', 'STEM Education', 'STEM education, science education, coding bootcamps, computer science education, engineering education, math education', 'education'),
  t('student-life', 'Student Life', 'Student experience, campus life, student housing, student debt, internships, student organizations, academic life', 'education'),
  t('academic-research', 'Academic Research', 'Academic research, research funding, grant writing, tenure, academic publishing, research institutions, PhD life', 'education'),
  t('early-childhood', 'Early Childhood', 'Early childhood education, preschool, kindergarten, child development, early learning, parenting education', 'education'),
  t('vocational-training', 'Vocational Training', 'Vocational training, trade schools, apprenticeships, skills-based education, professional certifications, workforce training', 'education'),
];

const TRAVEL_TAGS: TagDef[] = [
  t('destinations', 'Destinations', 'Travel destinations, travel guides, city guides, country profiles, travel itineraries, must-visit places', 'travel'),
  t('aviation', 'Aviation', 'Commercial aviation, airlines, airports, flight routes, aviation industry, aircraft, frequent flyer, airline reviews', 'travel'),
  t('railways', 'Railways', 'Railways, high-speed rail, train travel, rail infrastructure, commuter rail, Amtrak, European trains, metro systems', 'travel'),
  t('urban-planning', 'Urban Planning', 'Urban planning, city design, zoning, walkable cities, transit-oriented development, public spaces, urbanism', 'travel'),
  t('cycling-infra', 'Cycling Infrastructure', 'Cycling infrastructure, bike lanes, cycling cities, bike-sharing, cycling safety, cycling advocacy, bikeable cities', 'travel'),
  t('public-transit', 'Public Transit', 'Public transportation, bus systems, subway systems, light rail, transit policy, transit ridership, transit agencies', 'travel'),
  t('road-trips', 'Road Trips', 'Road trips, driving routes, scenic highways, road trip planning, car travel, cross-country driving, campervan travel', 'travel'),
  t('adventure-travel', 'Adventure Travel', 'Adventure travel, backpacking, trekking, expedition travel, wilderness travel, adventure sports destinations', 'travel'),
  t('hotels-lodging', 'Hotels & Lodging', 'Hotels, hostels, vacation rentals, Airbnb, resort reviews, accommodation, boutique hotels, hotel industry', 'travel'),
  t('cruise', 'Cruises', 'Cruise travel, cruise lines, cruise ship reviews, river cruises, expedition cruises, cruise industry, cruise ports', 'travel'),
  t('travel-tech', 'Travel Tech', 'Travel technology, booking platforms, travel apps, flight search engines, travel fintech, travel industry tech', 'travel'),
  t('logistics', 'Logistics', 'Logistics, shipping, freight, supply chain management, last-mile delivery, warehousing, global trade logistics', 'travel'),
];

const HISTORY_TAGS: TagDef[] = [
  t('ancient-history', 'Ancient History', 'Ancient history, ancient civilizations, Rome, Greece, Egypt, Mesopotamia, classical antiquity, ancient warfare', 'history'),
  t('medieval-history', 'Medieval History', 'Medieval history, Middle Ages, feudalism, Crusades, medieval Europe, Byzantine Empire, medieval culture', 'history'),
  t('modern-history', 'Modern History', 'Modern history, 19th and 20th century history, World Wars, Cold War, industrial revolution, modern geopolitics', 'history'),
  t('archaeology', 'Archaeology', 'Archaeology, archaeological discoveries, excavations, archaeological methods, dating techniques, artifacts, field work', 'history'),
  t('military-history', 'Military History', 'Military history, battles, wars, military strategy, military technology, naval history, military campaigns', 'history'),
  t('social-history', 'Social History', 'Social history, cultural history, history of everyday life, labor history, immigration history, civil rights history', 'history'),
  t('ethics', 'Ethics', 'Ethics, moral philosophy, bioethics, business ethics, ethical theory, applied ethics, ethical dilemmas, metaethics', 'history'),
  t('epistemology', 'Epistemology', 'Epistemology, theory of knowledge, rationalism, empiricism, skepticism, philosophy of science, justification', 'history'),
  t('political-philosophy', 'Political Philosophy', 'Political philosophy, liberalism, conservatism, socialism, libertarianism, democracy theory, justice theory, political theory', 'history'),
  t('philosophy-mind', 'Philosophy of Mind', 'Philosophy of mind, consciousness, free will, personal identity, mind-body problem, philosophy of AI, phenomenology', 'history'),
  t('history-of-science', 'History of Science', 'History of science, scientific revolutions, history of mathematics, history of technology, great scientists, intellectual history', 'history'),
  t('religion', 'Religion', 'Religion, theology, world religions, religious history, secularism, religious philosophy, comparative religion', 'history'),
];

// ─── DEPTH ANCHORS ──────────────────────────────────────────────────────────
// Five anchor descriptions used to compute a continuous depth_score (0.0–1.0).
// Embedded in memory on startup; article embeddings compared via cosine similarity.
// Math: softmax over 5 anchor similarities → weighted average with fixed weights.

export interface DepthAnchorDef {
  readonly key: 'noise' | 'shallow' | 'standard' | 'substantive' | 'dense';
  readonly weight: number;  // the score value for this anchor
  readonly description: string;
}

export const DEPTH_ANCHORS: readonly DepthAnchorDef[] = [
  {
    key: 'noise',
    weight: 0.1,
    description: 'Low-effort filler, corporate press releases, SEO spam, marketing copy, product promotions, hiring advertisements, sponsored content, and company propaganda disguised as news. Lacks meaningful insight or value.',
  },
  {
    key: 'shallow',
    weight: 0.3,
    description: 'Short news briefs, breaking news wires, quick product announcements, listicles, clickbait headlines, and thin aggregation. Provides basic awareness but lacks deep analysis or original thought.',
  },
  {
    key: 'standard',
    weight: 0.5,
    description: 'Standard journalism, opinion editorials, personal essays, commentary, interviews, Q&A profiles, and moderate-depth articles. Good for daily reading, keeping up with trends, and general perspectives.',
  },
  {
    key: 'substantive',
    weight: 0.7,
    description: 'High-value, long-form content. In-depth tutorials, practical step-by-step guides, architectural case studies, detailed postmortems, investigative reporting, and thorough technical analysis backed by evidence and examples.',
  },
  {
    key: 'dense',
    weight: 0.9,
    description: 'Extremely rigorous, peer-reviewed academic research papers, formal scientific publications, comprehensive systematic reviews, complex mathematical proofs, and deeply theoretical white papers requiring significant subject matter expertise.',
  },
];

// ─── COMBINED ───────────────────────────────────────────────────────────────

export const BUILTIN_TAGS: readonly TagDef[] = [
  ...PROGRAMMING_TAGS,
  ...ENGINEERING_TAGS,
  ...AI_ML_TAGS,
  ...SECURITY_TAGS,
  ...HARDWARE_TAGS,
  ...SCIENCE_TAGS,
  ...SPACE_TAGS,
  ...ENERGY_TAGS,
  ...POLITICS_TAGS,
  ...ECONOMICS_TAGS,
  ...BUSINESS_TAGS,
  ...GAMING_TAGS,
  ...FILM_TV_TAGS,
  ...MUSIC_TAGS,
  ...SPORTS_TAGS,
  ...FOOD_TAGS,
  ...BOOKS_TAGS,
  ...DESIGN_TAGS,
  ...HEALTH_TAGS,
  ...EDUCATION_TAGS,
  ...TRAVEL_TAGS,
  ...HISTORY_TAGS,
];
