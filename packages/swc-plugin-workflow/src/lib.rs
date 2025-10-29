#![allow(clippy::not_unsafe_ptr_arg_deref)]

use serde::Deserialize;
use std::path::Path;
use swc_core::{
    ecma::{ast::*, visit::*},
    plugin::{plugin_transform, proxies::TransformPluginProgramMetadata},
};
use swc_workflow::{StepTransform, TransformMode};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WasmConfig {
    mode: TransformMode,
}

#[plugin_transform]
pub fn process_transform(
    mut program: Program,
    metadata: TransformPluginProgramMetadata,
) -> Program {
    println!("[SWC Plugin] ===== INICIO TRANSFORM ===== ");
    let plugin_config: WasmConfig = serde_json::from_str(
        &metadata
            .get_transform_plugin_config()
            .expect("failed to get plugin config for workflow transform"),
    )
    .expect("Should provide plugin config");

    let filename = metadata.get_context(&swc_core::plugin::metadata::TransformPluginMetadataContextKind::Filename)
        .unwrap_or_else(|| "unknown".to_string());
    
    println!("[SWC Plugin] filename: {}", filename);
    println!("[SWC Plugin] mode: {:?}", plugin_config.mode);
    
    // Normalize filename to use forward slashes for consistent workflowId generation
    let normalized_filename = filename.replace('\\', "/");
    
    // Try to get cwd and make the path relative
    let cwd = metadata.get_context(&swc_core::plugin::metadata::TransformPluginMetadataContextKind::Cwd);
    
    println!("[SWC Plugin] filename: {}", filename);
    println!("[SWC Plugin] normalized_filename: {}", normalized_filename);
    println!("[SWC Plugin] cwd: {:?}", cwd);
    
    let relative_filename = if let Some(cwd) = cwd {
        let cwd_path = Path::new(&cwd);
        let file_path = Path::new(&normalized_filename);
        
        // Try to strip the cwd prefix to make it relative
        if let Ok(relative) = file_path.strip_prefix(cwd_path) {
            let result = relative.to_string_lossy().to_string();
            println!("[SWC Plugin] relative_filename (strip_prefix): {}", result);
            result
        } else {
            // Find common ancestor path
            let cwd_components: Vec<_> = cwd_path.components().collect();
            let file_components: Vec<_> = file_path.components().collect();
            
            // Find the longest common prefix
            let common_len = cwd_components.iter()
                .zip(file_components.iter())
                .take_while(|(a, b)| a == b)
                .count();
            
            if common_len > 0 {
                // Build relative path from the common ancestor
                let remaining_file: Vec<_> = file_components.into_iter().skip(common_len).collect();
                let relative_path = remaining_file.into_iter().collect::<std::path::PathBuf>();
                let result = relative_path.to_string_lossy().to_string();
                println!("[SWC Plugin] relative_filename (common ancestor): {}", result);
                result
            } else {
                println!("[SWC Plugin] relative_filename (no common ancestor): {}", normalized_filename);
                normalized_filename
            }
        }
    } else {
        println!("[SWC Plugin] relative_filename (no cwd): {}", normalized_filename);
        normalized_filename
    };
    
    println!("[SWC Plugin] final relative_filename: {}", relative_filename);
    
    let mut visitor = StepTransform::new(plugin_config.mode, relative_filename);
    program.visit_mut_with(&mut visitor);
    program
}
