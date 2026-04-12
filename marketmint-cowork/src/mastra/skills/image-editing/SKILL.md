---
name: image-editing
description: Use ONLY when the user explicitly wants to edit an existing photo/image (e.g. crop, resize, remove background, change color, add/remove elements). Do NOT use for converting sketches or concept drawings into realistic product images—use sketch-to-product for that. Do NOT use for extracting images from URLs, generating new/marketing images, or "extract from URL then generate" flows—use creative-generation for those.
---

# Image Editing Guide

This document gives you information on how to handle any image editing requests from the user. All image editing requests should be handled basis the information contained in this document.

Example requests:
- "Change the colour of the shirt to blue" 
- "Add a dog in the background to the 5th image"

---
## Required Tools

You must use the existing `imageEdit` tool. You should ENSURE THAT YOU USE only the `imageEdit` tool to edit the attached images. NOTHING ELSE SHOULD BE USED, FAILURE TO FOLLOW THIS WILL RESULT IN SERIOUS CUSTOMER CHURN AND LOSSES TO THE TUNE OF POTENTIALLY MILLIONS OF DOLLARS.
---

---
## Plan template

For image editing, use a minimal plan (one or two steps). Example bullets:
- Confirm which image(s) to edit (if multiple outputs exist) or use the attached/latest image.
- Apply the edit and show results.

If the user has already attached the image and the edit request in the same message, you may skip displaying a plan and execute directly.

---
NOTE: There is no need to generate a plan for any image editing related request. Please follow the instructions listed below on how to handle image editing related requests and follow suit.

- Things to check for and clarification questions to ask before executing the `imageEdit` tool:
     - If the user has already attached the asset in the current message and is requesting to edit it, then we should directly call the `imageEdit` tool with the shoe asset URL being passed in the `original_image_url` along with the edit request as `user_edit_request` as part of the `image_edits` parameter of the `imageEdit` tool call and should execute the tool.
       Example:
       a. User mentions "change the colour of the shoe to blue" and has attached the url in the same message, then you should make the call to the `imageEdit` tool with the following parameters:
          - `original_asset_url`: this can be kept empty since the asset is already attached in the current message.
          - `image_edits` : [{{"original_image_url": "<shoe_url>", "user_edit_request": "change the colour of the shoe to blue", "aspect_ratio":"1:1"}}]
          - `acknowledgement` : "Got it! Editing your shoe now 🎨✨"
          - Execute the tool.
          - NOTE: The above is just an example. You should make the tool call with the proper asset URLs from the asset catalog provided above and other appropriate parameter values.

     - If the user has not attached the asset that they want to edit, then you should check the following:
       1.  If the user has just executed a tool and has generated multiple outputs (you can check the asset catalog to check if the user just executed a tool and what were the generated assets), then you should ask the user whether they want to apply the edit to all of the generated outputs , any one of the generated outputs or they want to edit any one of their older uploaded assets.
           NOTE: IT IS HIGHLY IMPORTANT THAT YOU ASK THE USER THIS QUESTION AS TO WHICH OF THE GENERATED OUTPUTS THEY WANT TO EDIT, ANY SPECIFIC ONES OR ALL OF THEM . THIS IS ONLY APPLICABLE IF THE LATEST GENERATED OUTPUTS WERE MULTIPLE. NOT ASKING THIS QUESTION IF THERE WERE MULTIPLE IMAGES THAT WERE JUST GENERATED COULD LEAD TO POTENTIAL LOSSES TO THE TUNE OF MILLIONS OF DOLLARS. IF IT WAS A SINGLE OUTPUT THAT WAS GENERATED FROM THE LAST TOOL EXECUTION THEN YOU NEED NOT ASK THIS QUESTION, YOU CAN DIRECTLY GO AHEAD AND EDIT THE LATEST OUTPUT GENERATED. YOU NEED TO INCLUDE THE CORRESPONDING URLS IN THE `image_edits` LIST WITH THE ASSET URLS BEING PASSED IN THE `original_image_url` component of each entry. INCLUDE THE ORIGINAL IMAGE OF THE ASSET THAT THE USER MUST HAVE UPLOADED (IF UPLOADED, UNDERSTAND FROM CONVERSATION HISTORY AND CATALOG BEING PASSED) ONLY IN THE `original_asset_url` UNLESS THE USER HAS ASKED TO EDIT THE UPLOADED ASSET AS WELL IN WHICH CASE YOU SHOULD COMPLY.
                 - You should ask the user which of the generated outputs they want to edit in case mutliple outputs were generated in the last tool call, you should NOT ASK THE NUMBER OF VARIATIONS THEY NEED!.
           1.a. Once the user confirms their choice, you should extract the relevant URLs from the latest tool generated assets and pass them in the `imageEdit` tool call in the following format:
                - Lets say the user mentions "change the colour of the shoes to blue in the 3rd and 4th images" , then you should use the following sample format for the parameters:
                - `original_asset_url`: the original asset URL of the asset image that was used in the latest tool execution. 
                - `image_edits` : [{{"original_image_url": "<3rd_image_url>", "user_edit_request": "change the colour of the shoe to blue", "aspect_ratio":"1:1"}}, {{"original_image_url": "<4th_image_url>", "user_edit_request": "change the colour of the shoe to blue", "aspect_ratio":"1:1"}}]
                - `acknowledgement` : "Got it! Editing your shoes now 🎨✨"
                - Execute the tool.
                - NOTE: The above is just an example. You should make the tool call with the proper asset URLs picked from the asset catalog provided above and other appropriate parameter values.
       
        2. If the user has just executed a tool and has generated only a single image and the user asks to change something without exactly mentioning the asset that the user wants to edit, you need not ask the user as to which image he wants to edit as its understood that the user is referencing the latest generated image for the edit. In this case, you should make the call to the `imageEdit` tool with the following parameters:
                - `original_asset_url`: the original asset URL of the asset image that was used in the latest tool execution. 
                - `image_edits` : [{{"original_image_url": "<latest_generated_image_url>", "user_edit_request": "change the colour of the shoe to blue", "aspect_ratio":"1:1"}}]
                - `acknowledgement` : "Got it! Editing your shoe now 🎨✨"
                - Execute the tool.
                - NOTE: The above is just an example. You should make the tool call with the proper asset URLs picked from the asset catalog provided above and other appropriate parameter values.
        
        3. If the user has not executed any tool yet and has not even uploaded any assets but the user mentions to edit an image or references editing images, then you should ask the user to upload the asset that they want to edit and once the user does so then you can make the call to the `imageEdit` tool with the relevant parameters.

    - IMPORTANT POINTS:
       - Never ever hallucinate the asset URLs. Always use the asset URLs directly from the asset catalog. Do not combine, do not comma separate , do not concatenate, pass the individual valid asset URLs as it is from the asset catalog.
       - FAILURE TO FOLLOW THIS ABOVE INSTRUCTION WILL RESULT IN A VERY BAD USER EXPERIENCE AND CAN LEAD TO SEVERE CUSTOMER CHURN AND LOSSES TO THE TUNE OF MILLIONS OF DOLLARS.
       - When passing the `original_asset_url` parameter in the `imageEdit` tool call, make sure that you are passing the right asset URL which was used to generate the output images which you are trying to edit since the purpose behind including this asset URL is to maintain product fidelity.
       - Remember that if the user asks you to edit an image and generate multiple variations of the same, then you should take the respective image asset URL and other reference assets that the user may have attached and make the `directImageGen` tool call with the edit request being passed in the `user_prompt` parameter and the associated asset URLs being passed in the `asset_urls` list. You should not call `imageEdit` for these types of requests.
       - NOTE! : When you ask clarification questions like the exact image they would like to edit in case of multiple previously generated outputs or any other question, ENSURE TO WAIT for the user to respond and DO NOT DIRECTLY EXECUTE the `directImageGen` tool. FAILURE TO FOLLOW THIS STRICTLY WILL RESULT IN CUSTOMER CHURN AND LOSSES TO THE TUNE OF MILLIONS OF DOLLARS.

    - Other parameters:
      - `aspect_ratio`: - If the user has asked to change the aspect ratio of the image to a particular aspect ratio, then you should pass the user requested aspect ratio in the `aspect_ratio` parameter of the `imageEdit` tool call and execute the tool.
                        - If the user has requested that the edited outputs should have a particular aspect ratio, then you should pass the user requested aspect ratio in the `aspect_ratio` parameter of the `imageEdit` tool call and execute the tool.
                        - The valid values for the `aspect_ratio` parameter are the following: "1:1", "2:3", "3:2", "21:9", "16:9", "9:16", "3:4", "4:3", "4:5", "5:4"
                        - If the user has mentioned a particular aspect ratio in their request which is not currently supported , then you can default to using the value "1:1" for the `aspect_ratio` parameter in the `imageEdit` tool call.
    
      - `acknowledgement`: Based on the user's request you should also include a small acknowledgement message acknowledging the user's request in an enthusiastic, funny and witty manner. You should include this acknowledgement message in the `acknowledgement` parameter of the `directImageGen` tool call.