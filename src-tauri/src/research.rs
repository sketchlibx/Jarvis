use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::task::JoinSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebResearchSource {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebResearchResponse {
    pub query: String,
    pub summary: String,
    pub sources: Vec<WebResearchSource>,
    pub searched_at: String,
}

#[derive(Debug, Clone)]
struct DiscoveredResult {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Debug, Deserialize)]
struct DuckDuckGoResponse {
    #[serde(rename = "AbstractText")]
    abstract_text: Option<String>,
    #[serde(rename = "AbstractURL")]
    abstract_url: Option<String>,
    #[serde(rename = "Heading")]
    heading: Option<String>,
    #[serde(rename = "RelatedTopics")]
    related_topics: Option<Vec<serde_json::Value>>,
}

fn encode_query(query: &str) -> String {
    query.bytes().map(|b| match b {
        b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
        _ => format!("%{b:02X}"),
    }).collect()
}

fn value_string(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_owned).filter(|s| !s.trim().is_empty())
}

fn collect_topic_sources(topics: &[serde_json::Value], out: &mut Vec<WebResearchSource>) {
    for topic in topics {
        if out.len() >= 5 { break; }
        if let Some(url) = value_string(topic, "FirstURL") {
            let title = value_string(topic, "Text").unwrap_or_else(|| url.clone());
            out.push(WebResearchSource {
                title,
                url,
                snippet: value_string(topic, "Text").unwrap_or_default(),
            });
        }
        if let Some(nested) = topic.get("Topics").and_then(|x| x.as_array()) {
            collect_topic_sources(nested, out);
        }
    }
}

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn strip_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    decode_html_entities(out.trim())
}

fn parse_ddg_html_results(html: &str) -> Vec<DiscoveredResult> {
    let mut results = Vec::new();
    let mut cursor = 0usize;
    while results.len() < 5 {
        let rel_start = match html[cursor..].find("result__a") {
            Some(i) => cursor + i,
            None => break,
        };
        let anchor_start = html[..rel_start].rfind('<').unwrap_or(rel_start);
        let tag_end = match html[rel_start..].find('>') {
            Some(i) => rel_start + i,
            None => break,
        };
        let href_attr = &html[anchor_start..=tag_end];
        let href_marker = match href_attr.find("href=\"") {
            Some(i) => i + 6,
            None => { cursor = tag_end + 1; continue; }
        };
        let href_start = anchor_start + href_marker;
        let href_end = match html[href_start..].find('"') {
            Some(i) => href_start + i,
            None => { cursor = tag_end + 1; continue; }
        };
        let mut url = decode_html_entities(&html[href_start..href_end]);
        if let Some(pos) = url.find("uddg=") {
            let encoded = &url[pos + 5..];
            let end = encoded.find('&').unwrap_or(encoded.len());
            let candidate = encoded[..end].replace("%3A", ":").replace("%2F", "/").replace("%3F", "?").replace("%3D", "=").replace("%26", "&").replace("%25", "%");
            if candidate.starts_with("http") { url = candidate; }
        }
        let content_start = tag_end + 1;
        let content_end = match html[content_start..].find("</a>") {
            Some(i) => content_start + i,
            None => { cursor = tag_end + 1; continue; }
        };
        let title = strip_tags(&html[content_start..content_end]);
        if !url.starts_with("http") || title.is_empty() { cursor = content_end + 4; continue; }

        let snippet = if let Some(sn_start_rel) = html[content_end + 4..].find("result__snippet") {
            let sn_start = content_end + 4 + sn_start_rel;
            let open = html[sn_start..].find('>').map(|i| sn_start + i + 1);
            let close = open.and_then(|i| html[i..].find('<').map(|j| i + j));
            close.map(|end| strip_tags(&html[open.unwrap()..end])).unwrap_or_default()
        } else { String::new() };

        results.push(DiscoveredResult { title, url, snippet });
        cursor = content_end + 4;
    }
    results
}

/// Real, bounded web research backend. It uses DuckDuckGo's public
/// Instant Answer endpoint for discovery, then fetches up to five source
/// pages to provide the AI with real source text. It never invents a result;
/// network/HTTP/parser failures are returned to the caller.
pub async fn web_research(query: &str) -> Result<WebResearchResponse, String> {
    let query = query.trim();
    if query.is_empty() { return Err("research query cannot be empty".into()); }
    if query.len() > 400 { return Err("research query is too long".into()); }

    let client = Client::builder()
        .timeout(Duration::from_secs(9))
        .user_agent("JARVIS/0.1 research-client")
        .build()
        .map_err(|e| format!("research client: {e}"))?;

    let search_url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        encode_query(query)
    );
    let search = client
        .get(search_url)
        .send().await.map_err(|e| format!("web search request failed: {e}"))?
        .error_for_status().map_err(|e| format!("web search HTTP error: {e}"))?
        .json::<DuckDuckGoResponse>().await
        .map_err(|e| format!("web search response parse failed: {e}"))?;

    let mut discovered = Vec::<DiscoveredResult>::new();
    if let (Some(url), Some(summary)) = (search.abstract_url.clone(), search.abstract_text.clone()) {
        if !url.is_empty() {
            discovered.push(DiscoveredResult {
                title: search.heading.clone().unwrap_or_else(|| query.to_string()),
                url,
                snippet: summary,
            });
        }
    }
    if let Some(topics) = search.related_topics.as_deref() {
        let mut topic_sources = Vec::new();
        collect_topic_sources(topics, &mut topic_sources);
        discovered.extend(topic_sources.into_iter().map(|source| DiscoveredResult {
            title: source.title,
            url: source.url,
            snippet: source.snippet,
        }));
    }

    // Instant Answers are intentionally sparse for general queries. Fall back
    // to the public HTML results page when discovery produced no useful links.
    if discovered.len() < 3 {
        let html_url = format!("https://html.duckduckgo.com/html/?q={}", encode_query(query));
        if let Ok(resp) = client.get(html_url).send().await {
            if let Ok(resp) = resp.error_for_status() {
                if let Ok(html) = resp.text().await {
                    discovered.extend(parse_ddg_html_results(&html));
                }
            }
        }
    }

    let mut seen_urls = std::collections::HashSet::new();
    let mut sources = Vec::new();
    for item in discovered {
        if sources.len() >= 5 || !seen_urls.insert(item.url.clone()) { continue; }
        sources.push(WebResearchSource { title: item.title, url: item.url, snippet: item.snippet });
    }

    // Enrich source pages concurrently. The old sequential loop could take
    // roughly 5 × the HTTP timeout for a slow set of sources; bounded
    // concurrency keeps research responsive while still limiting the total
    // amount of external fetching.
    let selected_sources: Vec<WebResearchSource> = sources.into_iter().take(5).collect();
    let mut jobs: JoinSet<(usize, WebResearchSource)> = JoinSet::new();
    for (index, source) in selected_sources.into_iter().enumerate() {
        let client = client.clone();
        jobs.spawn(async move {
            let mut snippet = source.snippet.clone();
            if snippet.len() > 700 { snippet.truncate(700); }
            if let Ok(resp) = client.get(&source.url).send().await {
                if let Ok(resp) = resp.error_for_status() {
                    if let Ok(html) = resp.text().await {
                        let extracted = extract_text(&html);
                        if extracted.len() > snippet.len() {
                            snippet = extracted.chars().take(1400).collect();
                        }
                    }
                }
            }
            (index, WebResearchSource { snippet, ..source })
        });
    }

    let mut enriched_slots: Vec<Option<WebResearchSource>> = (0..5).map(|_| None).collect();
    while let Some(result) = jobs.join_next().await {
        if let Ok((index, source)) = result {
            if index < enriched_slots.len() { enriched_slots[index] = Some(source); }
        }
    }
    let enriched: Vec<WebResearchSource> = enriched_slots.into_iter().flatten().collect();

    let summary = search.abstract_text.unwrap_or_else(|| enriched.first().map(|s| s.snippet.clone()).unwrap_or_default());
    Ok(WebResearchResponse {
        query: query.to_string(),
        summary,
        sources: enriched,
        searched_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn extract_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len().min(20000));
    let mut in_tag = false;
    let mut in_script = false;
    let mut tag_buf = String::new();
    let mut last_space = false;
    let lower = html.to_ascii_lowercase();
    let bytes = html.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if !in_tag && lower[i..].starts_with("<script") { in_script = true; in_tag = true; tag_buf.clear(); i += 7; continue; }
        if !in_tag && lower[i..].starts_with("<style") { in_script = true; in_tag = true; tag_buf.clear(); i += 6; continue; }
        if in_script && lower[i..].starts_with("</script") { in_script = false; in_tag = true; tag_buf.clear(); i += 8; continue; }
        if in_script && lower[i..].starts_with("</style") { in_script = false; in_tag = true; tag_buf.clear(); i += 7; continue; }
        if bytes[i] == b'<' {
            in_tag = true;
            tag_buf.clear();
            i += 1;
            continue;
        }
        if in_tag {
            if bytes[i] == b'>' {
                in_tag = false;
            }
            i += 1;
            continue;
        }
        if in_script { i += 1; continue; }
        let ch = html[i..].chars().next().unwrap_or(' ');
        if ch.is_whitespace() {
            if !last_space { out.push(' '); last_space = true; }
        } else {
            out.push(ch);
            last_space = false;
        }
        i += ch.len_utf8();
        if out.len() >= 14000 { break; }
    }
    out.trim().to_string()
}
