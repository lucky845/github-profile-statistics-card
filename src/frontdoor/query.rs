//! The query string as the original reads it.
//!
//! Three layers run before any handler looks at `req.query`, and each one changes what the next
//! sees. Express parses the string with qs' extended syntax, so a parameter name can describe a
//! whole tree. xss-clean then rewrites every `<` inside that tree to `&lt;`. hpp finally collapses
//! each top-level array to its last element. What comes out is why `?theme[]=dark&theme[]=light`
//! reaches a card as the single string "light", while `?theme[x]=dark` reaches it as an object
//! that the cache key spells `[object Object]`.
//!
//! The port is deliberately literal. Every branch below mirrors a branch in qs' parse.js or
//! utils.js, including the ones that read as accidents: a scalar landing where an object already
//! sits becomes a two-element array, an index past the array limit turns the array back into an
//! object with numeric keys, and a repeated key concatenates instead of replacing. Those
//! accidents are the behaviour the recorded answers came from, so smoothing them out here would
//! put the two servers back out of step.

use super::keys;

/// qs' bracket depth. A sixth group stays inside the fifth segment as a literal `[f]`.
const DEPTH: usize = 5;

/// qs' parameter limit: the `&` split keeps only this many parts.
const PARAMETER_LIMIT: usize = 1000;

/// qs' array limit, raised from its default of 20 by express (express/lib/utils.js).
const ARRAY_LIMIT: i64 = 1000;

/// One value in the parsed tree. qs builds JavaScript objects and arrays; these are the two
/// containers it can build, and a string is the only leaf it can put in them.
enum Node {
    Str(String),
    Arr(Arr),
    Obj(Obj),
}

/// A JavaScript array. `slots` may hold holes: `a[5]=x` produces an array whose first five
/// entries are absent, which is different from five entries holding undefined.
struct Arr {
    slots: Vec<Option<Node>>,
    /// Set when this array is the two-element wrapper strictMerge built out of a conflict; the
    /// value is the highest index a later scalar was appended at.
    conflict: Option<i64>,
}

/// A JavaScript object, kept in insertion order because qs' merge is order-sensitive.
struct Obj {
    entries: Vec<(String, Node)>,
    /// Set when the object is really an over-limit array (qs' overflow side channel); the value
    /// is the highest numeric index handed out so far.
    overflow: Option<i64>,
    /// The object twin of `Arr::conflict`.
    conflict: Option<i64>,
}

impl Obj {
    fn new() -> Self {
        Obj {
            entries: Vec::new(),
            overflow: None,
            conflict: None,
        }
    }

    fn index_of(&self, key: &str) -> Option<usize> {
        self.entries.iter().position(|(name, _)| name == key)
    }

    fn has(&self, key: &str) -> bool {
        self.index_of(key).is_some()
    }

    /// `obj[key] = value`: an existing key keeps its position, a new one lands at the end.
    fn set(&mut self, key: String, value: Node) {
        match self.index_of(&key) {
            Some(at) => self.entries[at].1 = value,
            None => self.entries.push((key, value)),
        }
    }

    /// Move a value out while leaving the key where it is, so a merge cannot reorder the object.
    fn take(&mut self, key: &str) -> Option<Node> {
        self.index_of(key)
            .map(|at| std::mem::replace(&mut self.entries[at].1, Node::Str(String::new())))
    }
}

impl Arr {
    fn new() -> Self {
        Arr {
            slots: Vec::new(),
            conflict: None,
        }
    }

    fn from(slots: Vec<Option<Node>>) -> Self {
        Arr {
            slots,
            conflict: None,
        }
    }

    fn len(&self) -> i64 {
        self.slots.len() as i64
    }

    fn has(&self, index: i64) -> bool {
        usize::try_from(index)
            .ok()
            .and_then(|at| self.slots.get(at))
            .is_some_and(Option::is_some)
    }

    fn set(&mut self, index: i64, value: Node) {
        let Ok(at) = usize::try_from(index) else {
            return;
        };
        if self.slots.len() <= at {
            self.slots.resize_with(at + 1, || None);
        }
        self.slots[at] = Some(value);
    }
}

/// Parse a raw query string into the pairs a handler ends up reading, in the order the original
/// leaves them. Keys and values are already folded — a tree became its string form here, not
/// later — because every caller only ever wants the scalar the original would have seen.
pub fn parse(raw: Option<&str>) -> Vec<(String, String)> {
    tree(raw).map_or_else(Vec::new, project)
}

/// The tree qs builds, after xss-clean and compact — everything the two readings below share.
/// None stands for the empty string and the absent string, both of which qs parses to no entries.
fn tree(raw: Option<&str>) -> Option<Node> {
    let raw = raw?;
    // qs returns {} for the empty string rather than a single empty parameter.
    if raw.is_empty() {
        return None;
    }

    let mut root = Node::Obj(Obj::new());
    for (key, value) in parse_values(&brackets_decoded(raw)) {
        root = merge(root, parse_object(&split_key(&key), value));
    }

    Some(escape_less_than(compact(root)))
}

/// How one query key looks once qs, xss-clean and hpp have each had it.
///
/// The original reads the theme key from three angles, and they disagree: the platform cache key
/// stringifies whatever is there, the juejin and bilibili middlewares run firstString over it, and
/// validateTheme calls replace on it. A theme that arrived as theme[x]=a is an object, so the first
/// two still produce something — "[object Object]" and, for an object, the empty string — while the
/// third throws and the request ends in a 500. Folding all three answers into one struct is what
/// lets the dispatcher reproduce that without a second parse of the query.
pub struct Folded {
    /// String(value): a template literal puts this in the cache key, which is how an object
    /// becomes the literal [object Object] inside an X-Cache-Key header.
    pub text: String,
    /// firstString(value): the string itself, or the first element of an array when that element
    /// is a string. Everything else reads as the empty string.
    pub first: String,
    /// Whether the value is a string. validateTheme calls replace on it, so anything else is a
    /// TypeError the original never catches.
    pub text_valued: bool,
}

/// One top-level key, read the way each of the original's consumers reads it.
pub fn folded(raw: Option<&str>, key: &str) -> Option<Folded> {
    let value = entries_of(tree(raw)?)
        .into_iter()
        .find(|(name, _)| name == key)?
        .1;
    // hpp keeps the last element of a top-level array, and that element can itself be a
    // container: theme[0][]=1 reaches the validators as an array holding "1", not as "1". So the
    // collapse happens first and the is-it-still-an-array question is asked about the result.
    let value = match value {
        Node::Arr(arr) => match arr.slots.into_iter().next_back().flatten() {
            Some(value) => value,
            // An empty array reads as undefined: not a string, so replace throws, but firstString
            // has no element to look at.
            None => {
                return Some(Folded {
                    text: "undefined".to_string(),
                    first: String::new(),
                    text_valued: false,
                });
            }
        },
        other => other,
    };
    let (text, first, text_valued) = match &value {
        Node::Str(text) => (text.clone(), text.clone(), true),
        Node::Arr(arr) => (
            js_string(&value),
            match arr.slots.first().and_then(Option::as_ref) {
                Some(Node::Str(head)) => head.clone(),
                _ => String::new(),
            },
            false,
        ),
        Node::Obj(_) => (js_string(&value), String::new(), false),
    };
    Some(Folded {
        text,
        first,
        text_valued,
    })
}

/// qs' parseValues: split on `&`, decode each side, and combine repeats into one entry.
///
/// The split point is not simply the first `=`: a key ending in `]=` keeps its brackets, so
/// `a[]=1` has to be read with `]` as the last character of the key. That is why the search
/// looks for `]=` first.
fn parse_values(cleaned: &str) -> Vec<(String, Node)> {
    let mut pairs: Vec<(String, Node)> = Vec::new();
    for part in cleaned.split('&').take(PARAMETER_LIMIT) {
        // -1 when the part carries no '=' at all, which qs reads as an empty value.
        let Some(pos) = split_point(part) else {
            let key = decode(part);
            // An empty key produces no segments, so its value never reaches the tree — the same
            // path `?a=1&&b=2` takes, where the empty part contributes nothing.
            if !key.is_empty() {
                push_value(&mut pairs, key, Node::Str(String::new()));
            }
            continue;
        };
        // `[]` belongs to the key, so the check sits at the split point, not anywhere else.
        let empty_bracket_key = pos > 1 && part.get(pos - 2..pos) == Some("[]");
        let key = decode(&part[..pos]);
        let value = decode(&part[pos + 1..]);
        let value = if empty_bracket_key {
            Node::Arr(Arr::from(vec![Some(Node::Str(value))]))
        } else {
            Node::Str(value)
        };
        push_value(&mut pairs, key, value);
    }
    pairs
}

/// The index just past the character that separates key from value, or None when there is none.
fn split_point(part: &str) -> Option<usize> {
    match part.find("]=") {
        Some(at) => Some(at + 1),
        None => part.find('='),
    }
}

/// duplicates is 'combine': a repeated key concatenates instead of replacing.
fn push_value(pairs: &mut Vec<(String, Node)>, key: String, value: Node) {
    match pairs.iter().position(|(name, _)| *name == key) {
        Some(at) => {
            let existing = std::mem::replace(&mut pairs[at].1, Node::Str(String::new()));
            pairs[at].1 = combine(existing, value);
        }
        None => pairs.push((key, value)),
    }
}

/// qs' splitKeyIntoSegments: the parent name, then each balanced `[...]` group.
///
/// Groups past the depth limit are not dropped — the remainder is wrapped back into one bracket
/// pair so it stays a single literal key, which is why `a[b][c][d][e][f][g]` keeps `[f][g]`
/// as the sixth segment instead of nesting again.
fn split_key(key: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let Some(first) = key.find('[') else {
        if !key.is_empty() {
            segments.push(key.to_string());
        }
        return segments;
    };
    if first > 0 {
        segments.push(key[..first].to_string());
    }

    let bytes = key.as_bytes();
    let mut open = Some(first);
    let mut collected = 0usize;
    while let Some(open_at) = open {
        if collected >= DEPTH {
            break;
        }
        let mut level = 1i32;
        let mut close = None;
        let mut at = open_at + 1;
        while at < bytes.len() {
            match bytes[at] {
                b'[' => level += 1,
                b']' => {
                    level -= 1;
                    if level == 0 {
                        close = Some(at);
                        break;
                    }
                }
                _ => {}
            }
            at += 1;
        }
        let Some(close_at) = close else {
            // Unterminated: the raw remainder stays one literal segment.
            segments.push(format!("[{}]", &key[open_at..]));
            return segments;
        };
        segments.push(key[open_at..=close_at].to_string());
        collected += 1;
        open = key[close_at + 1..]
            .find('[')
            .map(|offset| close_at + 1 + offset);
    }
    if let Some(open_at) = open {
        segments.push(format!("[{}]", &key[open_at..]));
    }
    segments
}

/// qs' parseObject: build the tree from the innermost segment outwards.
///
/// A bracketed number becomes an array index while it stays below the array limit; at or above
/// it the container is an object with that numeric key instead, which is the shape the array
/// limit exists to prefer.
fn parse_object(chain: &[String], value: Node) -> Node {
    let mut leaf = value;
    for root in chain.iter().rev() {
        leaf = if root == "[]" {
            // An overflow object is already the right shape; wrapping it again would nest it.
            if overflow_of(&leaf).is_some() {
                leaf
            } else {
                combine_into_array(leaf)
            }
        } else {
            let clean = root
                .strip_prefix('[')
                .and_then(|rest| rest.strip_suffix(']'))
                .unwrap_or(root);
            match array_index(root, clean) {
                Some(index) if index < ARRAY_LIMIT => {
                    let mut arr = Arr::new();
                    arr.set(index, leaf);
                    Node::Arr(arr)
                }
                Some(index) => {
                    let mut obj = Obj::new();
                    obj.set(index.to_string(), leaf);
                    obj.overflow = Some(index);
                    Node::Obj(obj)
                }
                None if clean == "__proto__" => Node::Obj(Obj::new()),
                None => {
                    let mut obj = Obj::new();
                    obj.set(clean.to_string(), leaf);
                    Node::Obj(obj)
                }
            }
        };
    }
    leaf
}

/// The index a bracket group names, when it names one: a bare number, not `01`, ` 0 ` or `-1`.
fn array_index(root: &str, clean: &str) -> Option<i64> {
    let index = js_parse_int(clean)?;
    if clean == root {
        // An unbracketed segment is always a property name, never an index.
        return None;
    }
    if index >= 0 && index.to_string() == clean {
        Some(index)
    } else {
        None
    }
}

/// `[].concat(leaf)`: the leaf's elements when it is an array, the leaf itself otherwise.
fn combine_into_array(leaf: Node) -> Node {
    concat_over_limit(into_slots(leaf))
}

/// An array built from these slots, or the overflow object qs turns it into once it is too long.
fn concat_over_limit(slots: Vec<Option<Node>>) -> Node {
    let len = slots.len() as i64;
    if len > ARRAY_LIMIT {
        overflowed(Node::Arr(Arr::from(slots)), len - 1)
    } else {
        Node::Arr(Arr::from(slots))
    }
}

/// The elements a value contributes when spread into an array.
fn into_slots(node: Node) -> Vec<Option<Node>> {
    match node {
        Node::Arr(arr) => arr.slots,
        other => vec![Some(other)],
    }
}

/// `[].concat(a, b)`, holes included: concat copies absent entries as absent.
fn concat_values(first: Node, second: Node) -> Vec<Option<Node>> {
    let mut slots = into_slots(first);
    slots.extend(into_slots(second));
    slots
}

/// qs' markOverflow(arrayToObject(...)): an over-long array becomes an object keyed by index.
fn overflowed(node: Node, max_index: i64) -> Node {
    match node {
        Node::Arr(arr) => {
            let mut obj = Obj::new();
            for (index, slot) in arr.slots.into_iter().enumerate() {
                if let Some(value) = slot {
                    obj.entries.push((index.to_string(), value));
                }
            }
            obj.overflow = Some(max_index);
            Node::Obj(obj)
        }
        // Already an overflow object: qs keeps the leaf as it is.
        other => other,
    }
}

fn overflow_of(node: &Node) -> Option<i64> {
    match node {
        Node::Obj(obj) => obj.overflow,
        _ => None,
    }
}

fn is_container(node: &Node) -> bool {
    matches!(node, Node::Arr(_) | Node::Obj(_))
}

/// utils.combine when both sides come from parseValues: concatenate, or overflow past the limit.
fn combine(first: Node, second: Node) -> Node {
    match first {
        Node::Obj(mut obj) => match obj.overflow {
            // Already overflowed: the new values continue at the next free index.
            Some(mut max) => {
                for value in into_slots(second).into_iter().flatten() {
                    max += 1;
                    obj.set(max.to_string(), value);
                }
                obj.overflow = Some(max);
                Node::Obj(obj)
            }
            None => concat_over_limit(concat_values(Node::Obj(obj), second)),
        },
        other => concat_over_limit(concat_values(other, second)),
    }
}

/// utils.merge: the heart of it. Repeats concatenate, a scalar landing on an object becomes a
/// pair, and a pair that meets a third value grows in place instead of nesting.
fn merge(target: Node, source: Node) -> Node {
    match source {
        // `!source` in qs: an empty string leaves the target alone.
        Node::Str(text) if text.is_empty() => target,
        Node::Str(text) => merge_scalar(target, text),
        container => merge_container(target, container),
    }
}

fn merge_scalar(target: Node, text: String) -> Node {
    match target {
        Node::Arr(mut arr) => {
            let next = arr.len();
            if next >= ARRAY_LIMIT {
                let slots = concat_values(Node::Arr(arr), Node::Str(text));
                return overflowed(Node::Arr(Arr::from(slots)), next);
            }
            arr.slots.push(Some(Node::Str(text)));
            Node::Arr(arr)
        }
        Node::Obj(mut obj) => {
            if let Some(max) = obj.overflow {
                obj.set((max + 1).to_string(), Node::Str(text));
                obj.overflow = Some(max + 1);
            } else if let Some(last) = obj.conflict {
                obj.set((last + 1).to_string(), Node::Str(text));
                obj.conflict = Some(last + 1);
            } else {
                return strict_pair(Node::Obj(obj), Node::Str(text));
            }
            Node::Obj(obj)
        }
        // A scalar target has nowhere to hang a key, so the pair of them becomes an array. qs
        // does not mark this one as a conflict, and the difference is observable: a third value
        // nests here but appends to the marked form.
        Node::Str(existing) => Node::Arr(Arr::from(vec![
            Some(Node::Str(existing)),
            Some(Node::Str(text)),
        ])),
    }
}

/// `[target, source]`, marked so a repeated conflict appends instead of nesting again.
fn strict_pair(target: Node, source: Node) -> Node {
    Node::Arr(Arr {
        slots: vec![Some(target), Some(source)],
        conflict: Some(1),
    })
}

fn merge_container(target: Node, source: Node) -> Node {
    match target {
        Node::Str(text) => {
            if let Some(max) = overflow_of(&source) {
                // The scalar takes index 0 and the overflow object shifts up one.
                let mut obj = Obj::new();
                obj.set("0".to_string(), Node::Str(text));
                for (key, value) in entries_of(source) {
                    if let Some(index) = index_key(&key) {
                        obj.set((index + 1).to_string(), value);
                    }
                }
                obj.overflow = Some(max + 1);
                return Node::Obj(obj);
            }
            concat_over_limit(concat_values(Node::Str(text), source))
        }
        Node::Arr(arr) => match source {
            Node::Arr(source) => merge_arrays(arr, source),
            other => {
                let conflict = arr.conflict;
                let len = arr.len();
                let mut acc = slots_to_obj(arr.slots);
                // An array that was itself a conflict wrapper keeps counting from its last index
                // once it has been turned into an object.
                if conflict.is_some() {
                    acc.conflict = Some(len - 1);
                }
                merge_into_obj(acc, other)
            }
        },
        Node::Obj(obj) => merge_into_obj(obj, source),
    }
}

/// Two arrays merge by index. Where both sides hold containers the pair merges; where either
/// side holds a scalar the source value is appended, which is how `a[0]=1&a[1]=2&a[0]=3`
/// becomes `[[1,3],2]`.
fn merge_arrays(mut target: Arr, source: Arr) -> Node {
    for (index, slot) in source.slots.into_iter().enumerate() {
        // forEach visits present entries only, so a hole on the source side merges nothing.
        let Some(item) = slot else {
            continue;
        };
        let at = index as i64;
        let occupied = target.has(at);
        let both_containers = occupied
            && target.slots[index].as_ref().is_some_and(is_container)
            && is_container(&item);
        if both_containers {
            let existing = target.slots[index]
                .take()
                .expect("has() checked the slot is present");
            target.slots[index] = Some(merge(existing, item));
        } else if occupied {
            // Both sides hold a scalar here: qs appends instead of replacing, so a repeated
            // index collects its values in order.
            target.slots.push(Some(item));
        } else {
            // A hole on the target side takes the value at its own index, keeping the order the
            // indices describe rather than the order the parameters arrived in.
            target.set(at, item);
        }
    }
    let len = target.len();
    if len > ARRAY_LIMIT {
        return overflowed(Node::Arr(Arr::from(target.slots)), len - 1);
    }
    Node::Arr(target)
}

/// One array turned into an object, the way qs' arrayToObject does before a mixed merge.
fn slots_to_obj(slots: Vec<Option<Node>>) -> Obj {
    let mut obj = Obj::new();
    for (index, slot) in slots.into_iter().enumerate() {
        if let Some(value) = slot {
            obj.entries.push((index.to_string(), value));
        }
    }
    obj
}

/// The key-by-key merge qs finishes with.
fn merge_into_obj(mut acc: Obj, source: Node) -> Node {
    let source_overflow = overflow_of(&source);
    for (key, value) in entries_of(source) {
        if acc.has(&key) {
            let existing = acc.take(&key).expect("has() checked the key is present");
            acc.set(key.clone(), merge(existing, value));
        } else {
            acc.set(key.clone(), value);
        }
        if let Some(min) = source_overflow
            && acc.overflow.is_none()
        {
            acc.overflow = Some(max_numeric_index(&acc, min));
        }
        if let Some(current) = acc.overflow
            && let Some(index) = index_key(&key)
            && index > current
        {
            acc.overflow = Some(index);
        }
        if let Some(current) = acc.conflict
            && let Some(index) = index_key(&key)
            && index > current
        {
            acc.conflict = Some(index);
        }
    }
    Node::Obj(acc)
}

/// The entries a value contributes to a key-by-key merge: an object's own keys, or an array's
/// present indices as strings.
fn entries_of(node: Node) -> Vec<(String, Node)> {
    match node {
        Node::Obj(obj) => obj.entries,
        Node::Arr(arr) => arr
            .slots
            .into_iter()
            .enumerate()
            .filter_map(|(index, slot)| slot.map(|value| (index.to_string(), value)))
            .collect(),
        Node::Str(_) => Vec::new(),
    }
}

fn max_numeric_index(obj: &Obj, min: i64) -> i64 {
    let mut max = min;
    for (key, _) in &obj.entries {
        if let Some(index) = index_key(key)
            && index > max
        {
            max = index;
        }
    }
    max
}

/// `String(parseInt(key)) === key`: the property names JavaScript treats as array indices.
fn index_key(key: &str) -> Option<i64> {
    let index = js_parse_int(key)?;
    if index >= 0 && index.to_string() == key {
        Some(index)
    } else {
        None
    }
}

/// parseInt(s, 10): leading whitespace, an optional sign, then digits — and stop at the first
/// other character rather than failing. None stands for NaN.
fn js_parse_int(text: &str) -> Option<i64> {
    let trimmed = text.trim_start();
    let mut chars = trimmed.chars().peekable();
    let negative = match chars.peek() {
        Some('-') => {
            chars.next();
            true
        }
        Some('+') => {
            chars.next();
            false
        }
        _ => false,
    };
    let mut value: Option<i64> = None;
    while let Some(digit) = chars.peek().and_then(|c| c.to_digit(10)) {
        value = Some(
            value
                .unwrap_or(0)
                .saturating_mul(10)
                .saturating_add(i64::from(digit)),
        );
        chars.next();
    }
    value.map(|value| if negative { -value } else { value })
}

/// utils.compact: drop the holes out of every array, deepest last. qs pushes the containers onto
/// a queue and pops them off, which visits a nested array before the array holding it.
fn compact(node: Node) -> Node {
    match node {
        Node::Arr(arr) => {
            let slots = arr
                .slots
                .into_iter()
                .flatten()
                .map(|slot| Some(compact(slot)))
                .collect();
            Node::Arr(Arr {
                slots,
                conflict: arr.conflict,
            })
        }
        Node::Obj(obj) => Node::Obj(Obj {
            entries: obj
                .entries
                .into_iter()
                .map(|(key, value)| (key, compact(value)))
                .collect(),
            overflow: obj.overflow,
            conflict: obj.conflict,
        }),
        other => other,
    }
}

/// xss-clean: JSON round-trip with every `<` replaced. Round-tripping is the identity for the
/// tree qs builds, so only the replacement is left — and it lands on keys as well as values,
/// because the whole serialised object goes through one string replace.
fn escape_less_than(node: Node) -> Node {
    match node {
        Node::Str(text) => Node::Str(text.replace('<', "&lt;")),
        Node::Arr(arr) => Node::Arr(arr.map_slots(escape_less_than)),
        Node::Obj(obj) => Node::Obj(Obj {
            entries: obj
                .entries
                .into_iter()
                .map(|(key, value)| (key.replace('<', "&lt;"), escape_less_than(value)))
                .collect(),
            overflow: obj.overflow,
            conflict: obj.conflict,
        }),
    }
}

impl Arr {
    fn map_slots(self, mut map: impl FnMut(Node) -> Node) -> Self {
        Arr {
            slots: self
                .slots
                .into_iter()
                .map(|slot| slot.map(&mut map))
                .collect(),
            conflict: self.conflict,
        }
    }
}

/// hpp, then the string a handler would have seen.
///
/// hpp only rewrites arrays, and it keeps the last element of each — the original's "select the
/// first parameter value" comment is older than its `length - 1` subscript. Everything else
/// reaches the handler untouched.
fn project(root: Node) -> Vec<(String, String)> {
    let mut entries = entries_of(root);
    // Object.keys lists integer-like keys first, ascending, then the rest in insertion order.
    // defaultKeyGenerator sorts by key anyway, but the platform code reads the first "theme" it
    // finds, so the order qs leaves behind is part of the answer.
    let (mut indices, rest): (Vec<_>, Vec<_>) = entries
        .drain(..)
        .partition(|(key, _)| index_key(key).is_some());
    indices.sort_by_key(|(key, _)| index_key(key).unwrap_or(0));
    indices.extend(rest);
    indices
        .into_iter()
        .map(|(key, value)| {
            let value = match value {
                Node::Arr(arr) => arr.slots.into_iter().next_back().flatten(),
                other => Some(other),
            };
            // An array that hpp emptied leaves the key holding undefined, which is a value the
            // cache key spells out. Only a hand-written query can produce one.
            let text = value.map_or_else(|| "undefined".to_string(), |value| js_string(&value));
            (key, text)
        })
        .collect()
}

/// String(value) as JavaScript writes it: the template literal in defaultKeyGenerator turns an
/// object into this very phrase, and that is the text that reaches the cache key.
fn js_string(node: &Node) -> String {
    match node {
        Node::Str(text) => text.clone(),
        Node::Obj(_) => "[object Object]".to_string(),
        Node::Arr(arr) => arr
            .slots
            .iter()
            .map(|slot| slot.as_ref().map_or_else(String::new, js_string))
            .collect::<Vec<_>>()
            .join(","),
    }
}

/// qs replaces `%5B`/`%5D` in the whole string before it splits or decodes anything, which is
/// why an encoded bracket still opens a group while a doubly encoded one does not.
fn brackets_decoded(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' && at + 2 < bytes.len() && bytes[at + 1] == b'5' {
            match bytes[at + 2].to_ascii_lowercase() {
                b'b' => {
                    out.push('[');
                    at += 3;
                    continue;
                }
                b'd' => {
                    out.push(']');
                    at += 3;
                    continue;
                }
                _ => {}
            }
        }
        let rest = &raw[at..];
        let ch = rest.chars().next().expect("an index inside the string starts a character");
        out.push(ch);
        at += ch.len_utf8();
    }
    out
}

/// qs' decode: `+` is a space, then percent-decoding — lossily, where decodeURIComponent would
/// throw on a malformed escape and hand the string back unchanged.
fn decode(text: &str) -> String {
    keys::decode(&text.replace('+', " "))
}

#[cfg(test)]
mod tests {
    use super::parse;

    /// The pairs as the cache key spells them: "k=v" joined, which is what the recorded answers
    /// were keyed on.
    fn folded(raw: &str) -> String {
        parse(Some(raw))
            .into_iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("&")
    }

    #[test]
    fn a_repeated_key_keeps_the_last_value() {
        assert_eq!(folded("theme=dark&theme=light"), "theme=light");
        assert_eq!(folded("a=1&b=2&a=3"), "a=3&b=2");
        assert_eq!(folded("k=1&k=2&k=3"), "k=3");
    }

    #[test]
    fn an_empty_bracket_appends_and_hpp_keeps_the_last() {
        assert_eq!(folded("theme[]=dark&theme[]=light"), "theme=light");
        assert_eq!(folded("theme[]=dark"), "theme=dark");
        assert_eq!(folded("theme[]=dark&theme[0]=light"), "theme=light");
        assert_eq!(folded("a=1&a[]=2"), "a=2");
        assert_eq!(folded("zz5[]=1&zz5=2"), "zz5=2");
        assert_eq!(folded("zz6=1&zz6[]=2"), "zz6=2");
    }

    #[test]
    fn a_numeric_bracket_is_an_array_index() {
        assert_eq!(folded("theme[0]=dark&theme[1]=light"), "theme=light");
        assert_eq!(folded("theme[0]=dark"), "theme=dark");
    }

    #[test]
    fn an_object_reaches_the_key_as_its_string_form() {
        assert_eq!(folded("theme[x]=dark"), "theme=[object Object]");
        assert_eq!(folded("theme[a][b]=dark"), "theme=[object Object]");
        assert_eq!(folded("zz4[a]=1&zz4[b]=2"), "zz4=[object Object]");
    }

    #[test]
    fn a_scalar_landing_on_an_object_becomes_a_pair() {
        // strictMerge wraps instead of overwriting, and hpp then reads the last element.
        assert_eq!(folded("theme[x]=dark&theme=light"), "theme=light");
        assert_eq!(folded("theme=light&theme[x]=dark"), "theme=[object Object]");
        // A third value appends to the wrapper rather than nesting inside it.
        assert_eq!(
            folded("theme[]=a&theme=light&theme[x]=b"),
            "theme=[object Object]"
        );
    }

    #[test]
    fn an_index_past_the_array_limit_turns_the_array_into_an_object() {
        // express raises qs' array limit to 1000, so 999 is still an index.
        assert_eq!(folded("a[999]=x"), "a=x");
        assert_eq!(folded("a[1000]=x"), "a=[object Object]");
        assert_eq!(folded("a[-1]=x"), "a=[object Object]");
        assert_eq!(folded("a[01]=x"), "a=[object Object]");
        assert_eq!(folded("a[ 0 ]=x"), "a=[object Object]");
    }

    #[test]
    fn holes_are_compacted_but_the_order_of_the_values_is_kept() {
        assert_eq!(folded("theme[5]=a&theme[0]=b"), "theme=a");
        assert_eq!(folded("theme[1]=a&theme[0]=b"), "theme=a");
        assert_eq!(folded("theme[10]=a&theme[2]=b"), "theme=a");
    }

    #[test]
    fn depth_stops_at_five_groups() {
        // The sixth group stays inside the fifth as a literal key, so the value is an object.
        assert_eq!(
            folded("theme[a][b][c][d][e][f]=deep"),
            "theme=[object Object]"
        );
        assert_eq!(folded("theme[a][b]=dark"), "theme=[object Object]");
    }

    #[test]
    fn xss_clean_rewrites_every_less_than_sign() {
        assert_eq!(folded("theme=<script>alert(1)</script>"), "theme=<script>alert(1)</script>".replace('<', "&lt;"));
        // The key goes through the same string replace, because the whole object is serialised.
        assert_eq!(folded("th<eme=dark"), "th&lt;eme=dark");
        // A greater-than sign is not in the filter.
        assert_eq!(folded("theme=%3Cb%3E"), "theme=&lt;b>");
        assert_eq!(folded("x=<>&y=<>"), "x=&lt;>&y=&lt;>");
    }

    #[test]
    fn plus_percent_and_the_characters_a_key_reducer_would_eat() {
        assert_eq!(folded("x=a+b"), "x=a b");
        assert_eq!(folded("x=a%2Bb"), "x=a+b");
        assert_eq!(folded("x=%E4%B8%AD%E6%96%87"), "x=中文");
        assert_eq!(folded("zz=%26"), "zz=&");
        // Two backslashes survive; the cache key is what eats them, not the parser.
        assert_eq!(folded("zz=%22%27%5C%5C"), "zz=\"'\\\\");
    }

    #[test]
    fn an_encoded_bracket_still_opens_a_group() {
        // qs replaces %5B/%5D across the whole string before it splits anything.
        assert_eq!(folded("theme%5B%5D=dark&theme%5B%5D=light"), "theme=light");
        assert_eq!(folded("theme%5B0%5D=dark"), "theme=dark");
    }

    #[test]
    fn an_empty_value_is_a_key_with_nothing_after_the_colon() {
        assert_eq!(folded("theme="), "theme=");
        assert_eq!(folded("theme"), "theme=");
        assert_eq!(folded("&theme"), "theme=");
        assert_eq!(folded("theme[]=&theme[]="), "theme=");
    }

    #[test]
    fn the_empty_query_is_no_query() {
        assert_eq!(folded(""), "");
        assert_eq!(parse(None).len(), 0);
    }

    #[test]
    fn the_js_object_key_order_is_numeric_first_then_insertion() {
        // Object.keys walks integer-like keys in ascending order before the rest.
        let pairs = parse(Some("b=1&2=x&a=2&1=y"));
        assert_eq!(
            pairs
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>(),
            ["1", "2", "b", "a"]
        );
    }

    #[test]
    fn a_deeper_mix_still_lands_on_one_scalar() {
        assert_eq!(folded("a[0][x]=1"), "a=[object Object]");
        assert_eq!(folded("a[x][0]=1"), "a=[object Object]");
        // hpp hands back the inner array, and a template literal stringifies that as "1,2".
        assert_eq!(folded("a[0][]=1&a[0][]=2"), "a=1,2");
        assert_eq!(folded("a[0]=1&a[1]=2&a[0]=3"), "a=2");
        assert_eq!(folded("a[0]=x&a[b]=y"), "a=[object Object]");
    }

    #[test]
    fn a_plain_string_reads_the_same_three_ways() {
        let theme = super::folded(Some("theme=dark"), "theme").unwrap();
        assert_eq!(theme.text, "dark");
        assert_eq!(theme.first, "dark");
        assert!(theme.text_valued);
    }

    #[test]
    fn an_object_stringifies_but_has_no_first_string() {
        // The cache key spells it [object Object]; firstString has nothing to take; and the
        // validators' .replace throws because it is not a string.
        let theme = super::folded(Some("theme[x]=a"), "theme").unwrap();
        assert_eq!(theme.text, "[object Object]");
        assert_eq!(theme.first, "");
        assert!(!theme.text_valued);
    }

    #[test]
    fn an_array_element_survives_hpp_as_a_container() {
        // theme[0][]=1 is an array holding one array. hpp keeps the last top-level element, and
        // that element is itself an array: the key writes "1" through template-literal
        // stringification and firstString takes the head, but .replace still throws.
        let theme = super::folded(Some("theme[0][]=1"), "theme").unwrap();
        assert_eq!(theme.text, "1");
        assert_eq!(theme.first, "1");
        assert!(!theme.text_valued);
    }

    #[test]
    fn an_appended_scalar_is_a_string_and_survives_the_validators() {
        // theme[][]=1 is a plain array of strings, so hpp hands back "1" — a string.
        let theme = super::folded(Some("theme[][]=1"), "theme").unwrap();
        assert_eq!(theme.text, "1");
        assert_eq!(theme.first, "1");
        assert!(theme.text_valued);
    }

    #[test]
    fn a_missing_key_is_absent_rather_than_empty() {
        // undefined and "" are different answers: one makes validateTheme throw, the other is
        // skipped by its `if (theme)` guard.
        assert!(super::folded(Some("nocache=true"), "theme").is_none());
        assert!(super::folded(None, "theme").is_none());
        let empty = super::folded(Some("theme="), "theme").unwrap();
        assert_eq!(empty.text, "");
        assert!(empty.text_valued);
    }
}

